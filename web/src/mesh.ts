// Online games link players directly (WebRTC data channels, one per pair of
// tabs) and keep the relay as the fallback. The engine's sockets still open
// WebSockets to the room (udp.cpp, through globalThis.generalsXLanConnect);
// a datagram to a player with an open direct link goes over it instead, and
// everything else (lobby broadcasts, players whose network blocks direct
// links) stays on the relay. The relay also carries the signalling: each tab
// registers port 1 of its address in the room, says hello to everyone, and
// the tab with the lower address offers.
//
// Direct link messages: [destination port u16][source port u16][payload].

import type { Connect, LanSocket } from "./lan";

const PACKET = 2;
const HEADER_LEN = 7;
export const SIGNAL_PORT = 1;
const CONNECT_TIMEOUT_MS = 15_000;

type Signal =
  | { t: "hello" }
  | { t: "offer"; sdp: string }
  | { t: "answer"; sdp: string }
  | { t: "ice"; c: RTCIceCandidateInit };

interface Peer {
  pc: RTCPeerConnection;
  channel: RTCDataChannel | null;
  timer: ReturnType<typeof setTimeout>;
}

export interface MeshStats {
  direct: number[];
  directPackets: number;
  relayPackets: number;
}

/** The relay's STUN server: the same host, UDP 3478 (server/src/stun.rs). */
export function stunFor(relay: string): RTCIceServer[] {
  try {
    const url = new URL(relay);
    if (url.hostname === "127.0.0.1" || url.hostname === "localhost") return [];
    return [{ urls: `stun:${url.hostname}:3478` }];
  } catch {
    return [];
  }
}

class MeshSocket extends EventTarget implements LanSocket {
  private port = -1;

  constructor(
    private readonly mesh: Mesh,
    private readonly ws: WebSocket,
  ) {
    super();
    ws.binaryType = "arraybuffer";
    for (const type of ["open", "close", "error"]) ws.addEventListener(type, () => this.dispatchEvent(new Event(type)));
    ws.addEventListener("message", (event) => this.dispatchEvent(new MessageEvent("message", { data: event.data })));
    ws.addEventListener("close", () => this.mesh.unbind(this.port, this));
  }

  get binaryType(): string {
    return "arraybuffer";
  }

  set binaryType(_value: string) {
    // Always array buffers, from either path.
  }

  get readyState(): number {
    return this.ws.readyState;
  }

  send(data: ArrayBuffer | ArrayBufferView): void {
    const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    if (this.port < 0 && bytes.length === HEADER_LEN && bytes[0] === 1) {
      this.port = (bytes[5] << 8) | bytes[6];
      this.mesh.bind(this.port, this);
    } else if (bytes.length >= HEADER_LEN && bytes[0] === PACKET && this.port >= 0) {
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      if (this.mesh.sendDirect(view.getUint32(1), view.getUint16(5), this.port, bytes.subarray(HEADER_LEN))) return;
      this.mesh.stats.relayPackets++;
    }
    this.ws.send(bytes);
  }

  close(): void {
    this.mesh.unbind(this.port, this);
    this.ws.close();
  }

  /** A datagram that came over a direct link, as the relay would have framed it. */
  inject(ip: number, port: number, payload: Uint8Array): void {
    if (this.ws.readyState !== WebSocket.OPEN) return;
    const frame = new Uint8Array(HEADER_LEN + payload.length);
    const view = new DataView(frame.buffer);
    frame[0] = PACKET;
    view.setUint32(1, ip);
    view.setUint16(5, port);
    frame.set(payload, HEADER_LEN);
    this.dispatchEvent(new MessageEvent("message", { data: frame.buffer }));
  }
}

export class Mesh {
  readonly stats: MeshStats = { direct: [], directPackets: 0, relayPackets: 0 };
  private readonly sockets = new Map<number, MeshSocket>();
  private readonly peers = new Map<number, Peer>();
  private signal: WebSocket | null = null;
  private closed = false;
  // Signals are handled one at a time: an ICE candidate must wait for the offer before it.
  private signals: Promise<void> = Promise.resolve();

  constructor(
    private readonly url: string,
    private readonly ip: number,
    private readonly iceServers: RTCIceServer[],
  ) {}

  /** For globalThis.generalsXLanConnect. */
  connect: Connect = (url?: string) => new MeshSocket(this, new WebSocket(url ?? this.url));

  start(): void {
    if (this.closed) return;
    const ws = new WebSocket(this.url);
    ws.binaryType = "arraybuffer";
    this.signal = ws;
    ws.addEventListener("open", () => {
      const frame = new DataView(new ArrayBuffer(HEADER_LEN));
      frame.setUint8(0, 1);
      frame.setUint32(1, this.ip);
      frame.setUint16(5, SIGNAL_PORT);
      ws.send(frame.buffer);
      this.send(0xffffffff, { t: "hello" });
    });
    ws.addEventListener("message", (event) => {
      const bytes = new Uint8Array(event.data as ArrayBuffer);
      if (bytes.length < HEADER_LEN || bytes[0] !== PACKET) return;
      const from = new DataView(bytes.buffer).getUint32(1);
      try {
        const signal = JSON.parse(new TextDecoder().decode(bytes.subarray(HEADER_LEN))) as Signal;
        this.signals = this.signals.then(() => this.onSignal(from, signal)).catch(() => undefined);
      } catch {
        // Not ours: ignore, as a UDP socket would.
      }
    });
    ws.addEventListener("close", () => {
      if (this.signal === ws && !this.closed) setTimeout(() => this.start(), 3_000);
    });
  }

  close(): void {
    this.closed = true;
    this.signal?.close();
    for (const ip of [...this.peers.keys()]) this.drop(ip);
  }

  bind(port: number, socket: MeshSocket): void {
    this.sockets.set(port, socket);
  }

  unbind(port: number, socket: MeshSocket): void {
    if (this.sockets.get(port) === socket) this.sockets.delete(port);
  }

  /** True when the datagram went over a direct link. */
  sendDirect(ip: number, port: number, from: number, payload: Uint8Array): boolean {
    const channel = this.peers.get(ip)?.channel;
    if (!channel || channel.readyState !== "open") return false;
    const message = new Uint8Array(4 + payload.length);
    const view = new DataView(message.buffer);
    view.setUint16(0, port);
    view.setUint16(2, from);
    message.set(payload, 4);
    channel.send(message);
    this.stats.directPackets++;
    return true;
  }

  private send(ip: number, signal: Signal): void {
    const ws = this.signal;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const payload = new TextEncoder().encode(JSON.stringify(signal));
    const frame = new Uint8Array(HEADER_LEN + payload.length);
    const view = new DataView(frame.buffer);
    frame[0] = PACKET;
    view.setUint32(1, ip);
    view.setUint16(5, SIGNAL_PORT);
    frame.set(payload, HEADER_LEN);
    ws.send(frame);
  }

  private async onSignal(from: number, signal: Signal): Promise<void> {
    if (from === this.ip || this.closed) return;
    if (signal.t === "hello") {
      const peer = this.peers.get(from);
      if (peer && peer.pc.connectionState !== "failed" && peer.pc.connectionState !== "closed") return;
      if (this.ip < from) await this.offer(from);
      else this.send(from, { t: "hello" });
    } else if (signal.t === "offer") {
      if (this.peers.has(from)) this.drop(from);
      const peer = this.peer(from);
      peer.pc.addEventListener("datachannel", (event) => this.open(from, event.channel));
      await peer.pc.setRemoteDescription({ type: "offer", sdp: signal.sdp });
      await peer.pc.setLocalDescription(await peer.pc.createAnswer());
      this.send(from, { t: "answer", sdp: peer.pc.localDescription?.sdp ?? "" });
    } else if (signal.t === "answer") {
      const peer = this.peers.get(from);
      if (peer && peer.pc.signalingState === "have-local-offer") await peer.pc.setRemoteDescription({ type: "answer", sdp: signal.sdp });
    } else if (signal.t === "ice") {
      await this.peers.get(from)?.pc.addIceCandidate(signal.c).catch(() => undefined);
    }
  }

  private peer(ip: number): Peer {
    const pc = new RTCPeerConnection({ iceServers: this.iceServers });
    // A link that does not come up in time stays on the relay.
    const peer: Peer = { pc, channel: null, timer: setTimeout(() => peer.channel || this.drop(ip), CONNECT_TIMEOUT_MS) };
    this.peers.set(ip, peer);
    pc.addEventListener("icecandidate", (event) => {
      if (event.candidate) this.send(ip, { t: "ice", c: event.candidate.toJSON() });
    });
    pc.addEventListener("connectionstatechange", () => {
      if (pc.connectionState === "failed" || pc.connectionState === "closed") this.drop(ip);
    });
    return peer;
  }

  private async offer(ip: number): Promise<void> {
    const peer = this.peer(ip);
    this.open(ip, peer.pc.createDataChannel("openzh-mesh", { ordered: true }));
    await peer.pc.setLocalDescription(await peer.pc.createOffer());
    this.send(ip, { t: "offer", sdp: peer.pc.localDescription?.sdp ?? "" });
  }

  private open(ip: number, channel: RTCDataChannel): void {
    channel.binaryType = "arraybuffer";
    channel.addEventListener("open", () => {
      const peer = this.peers.get(ip);
      if (!peer) return;
      peer.channel = channel;
      clearTimeout(peer.timer);
      this.stats.direct = [...this.peers.entries()].filter(([, p]) => p.channel).map(([peerIp]) => peerIp);
    });
    channel.addEventListener("message", (event: MessageEvent) => {
      const message = new Uint8Array(event.data as ArrayBuffer);
      if (message.length < 4) return;
      const view = new DataView(message.buffer);
      this.sockets.get(view.getUint16(0))?.inject(ip, view.getUint16(2), message.subarray(4));
    });
    channel.addEventListener("close", () => {
      if (this.peers.get(ip)?.channel === channel) this.drop(ip);
    });
  }

  private drop(ip: number): void {
    const peer = this.peers.get(ip);
    if (!peer) return;
    this.peers.delete(ip);
    clearTimeout(peer.timer);
    peer.pc.close();
    this.stats.direct = this.stats.direct.filter((peerIp) => peerIp !== ip);
  }
}
