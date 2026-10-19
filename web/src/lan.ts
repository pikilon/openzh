// Games on a network without internet. The host's tab runs the relay itself
// (the same rules as server/src/relay.rs: one virtual LAN, leased addresses,
// broadcasts per port), and each guest's tab reaches it over one WebRTC data
// channel. The engine's sockets (udp.cpp) get virtual sockets that speak the
// relay's frames, through globalThis.generalsXLanConnect.
//
// Data channel messages, guest <-> host: [kind u8][socket u16][relay frame],
// kind 0 opens a socket (guest to host), 1 carries a frame, 2 closes it.

/** What udp.cpp and Lease need of a WebSocket. */
export interface LanSocket {
  binaryType: string;
  readonly readyState: number;
  send(data: ArrayBuffer | ArrayBufferView): void;
  close(): void;
  addEventListener(type: string, listener: (event: Event) => void): void;
}

export type Connect = (url?: string) => LanSocket;

const REGISTER = 1;
const PACKET = 2;
const HEADER_LEN = 7;
const LEASE_PORT = 0;
const SUBNET = 0x0a000000;

const OPEN = 0;
const FRAME = 1;
const CLOSE = 2;

function bytesOf(data: ArrayBuffer | ArrayBufferView): Uint8Array {
  return data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

/** A WebSocket look-alike whose other end is a function. */
export class VirtualSocket extends EventTarget implements LanSocket {
  binaryType = "arraybuffer";
  readyState = 0;

  constructor(
    private readonly sendTo: (frame: Uint8Array) => void,
    private readonly onClose: () => void,
  ) {
    super();
  }

  /** The other end is ready. */
  opened(): void {
    if (this.readyState !== 0) return;
    this.readyState = 1;
    this.dispatchEvent(new Event("open"));
  }

  receive(frame: Uint8Array): void {
    if (this.readyState !== 1) return;
    this.dispatchEvent(new MessageEvent("message", { data: frame.slice().buffer }));
  }

  /** The other end went away. */
  closed(): void {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.dispatchEvent(new Event("close"));
  }

  send(data: ArrayBuffer | ArrayBufferView): void {
    if (this.readyState !== 1) throw new DOMException("the socket is not open", "InvalidStateError");
    this.sendTo(bytesOf(data).slice());
  }

  close(): void {
    if (this.readyState === 3) return;
    this.onClose();
    this.closed();
  }
}

interface Member {
  address: [number, number] | null;
  deliver(frame: Uint8Array): void;
  drop(): void;
}

function key(ip: number, port: number): string {
  return `${ip >>> 0}:${port}`;
}

function leasable(ip: number): boolean {
  return (ip & 0xffffff00) >>> 0 === SUBNET && (ip & 0xff) !== 0 && (ip & 0xff) !== 0xff;
}

/** The relay of one virtual LAN, in the host's tab. */
export class LanHub {
  private readonly members = new Set<Member>();
  private readonly byAddress = new Map<string, Member>();

  get size(): number {
    return this.members.size;
  }

  /** A socket for this tab's own engine and lease. */
  connect: Connect = () => {
    let member: Member;
    const socket = new VirtualSocket(
      (frame) => this.receive(member, frame),
      () => this.leave(member),
    );
    member = { address: null, deliver: (frame) => socket.receive(frame), drop: () => socket.closed() };
    this.members.add(member);
    setTimeout(() => socket.opened(), 0);
    return socket;
  };

  /** A guest's data channel: each socket it opens becomes a member. */
  attach(channel: RTCDataChannel): void {
    channel.binaryType = "arraybuffer";
    const sockets = new Map<number, Member>();
    const send = (kind: number, id: number, frame?: Uint8Array) => {
      if (channel.readyState !== "open") return;
      const message = new Uint8Array(3 + (frame?.length ?? 0));
      message[0] = kind;
      message[1] = id >> 8;
      message[2] = id & 0xff;
      if (frame) message.set(frame, 3);
      channel.send(message);
    };
    channel.addEventListener("message", (event: MessageEvent) => {
      const message = new Uint8Array(event.data as ArrayBuffer);
      if (message.length < 3) return;
      const id = (message[1] << 8) | message[2];
      if (message[0] === OPEN && !sockets.has(id)) {
        const member: Member = {
          address: null,
          deliver: (frame) => send(FRAME, id, frame),
          drop: () => {
            sockets.delete(id);
            send(CLOSE, id);
          },
        };
        sockets.set(id, member);
        this.members.add(member);
      } else if (message[0] === FRAME) {
        const member = sockets.get(id);
        if (member) this.receive(member, message.subarray(3));
      } else if (message[0] === CLOSE) {
        const member = sockets.get(id);
        sockets.delete(id);
        if (member) this.leave(member);
      }
    });
    channel.addEventListener("close", () => {
      for (const member of sockets.values()) this.leave(member);
      sockets.clear();
    });
  }

  leave(member: Member): void {
    this.members.delete(member);
    if (member.address && this.byAddress.get(key(...member.address)) === member) {
      this.byAddress.delete(key(...member.address));
    }
  }

  private receive(member: Member, frame: Uint8Array): void {
    if (!this.members.has(member)) return;
    if (member.address === null) {
      this.register(member, frame);
      return;
    }
    if (frame.length < HEADER_LEN || frame[0] !== PACKET) return;
    const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
    const ip = view.getUint32(1);
    const port = view.getUint16(5);
    if (port === LEASE_PORT) return;
    const out = new Uint8Array(frame.length);
    out.set(frame);
    const outView = new DataView(out.buffer);
    outView.setUint32(1, member.address[0]);
    outView.setUint16(5, member.address[1]);
    if ((ip & 0xff) === 0xff) {
      for (const other of this.members) {
        if (other !== member && other.address !== null && other.address[1] === port) other.deliver(out);
      }
    } else {
      this.byAddress.get(key(ip, port))?.deliver(out);
    }
  }

  private register(member: Member, frame: Uint8Array): void {
    if (frame.length !== HEADER_LEN || frame[0] !== REGISTER) {
      member.drop();
      this.leave(member);
      return;
    }
    const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
    let ip = view.getUint32(1);
    const port = view.getUint16(5);
    if (port === LEASE_PORT) {
      const taken = (candidate: number) => [...this.byAddress.values()].some((m) => m.address?.[0] === candidate);
      if (!leasable(ip) || taken(ip)) {
        ip = 0;
        for (let n = 1; n < 0xff; n++) {
          if (!taken((SUBNET | n) >>> 0)) {
            ip = (SUBNET | n) >>> 0;
            break;
          }
        }
        if (ip === 0) {
          member.drop();
          this.leave(member);
          return;
        }
      }
    }
    const previous = this.byAddress.get(key(ip, port));
    if (previous && previous !== member) {
      // The same tab reopening its port: the old socket goes.
      previous.drop();
      this.leave(previous);
    }
    member.address = [ip, port];
    this.byAddress.set(key(ip, port), member);
    if (port === LEASE_PORT) {
      const reply = new Uint8Array(HEADER_LEN);
      const replyView = new DataView(reply.buffer);
      reply[0] = REGISTER;
      replyView.setUint32(1, ip);
      replyView.setUint16(5, LEASE_PORT);
      member.deliver(reply);
    }
  }
}

/** A guest's sockets, all through its one data channel to the host. */
export function channelConnect(channel: RTCDataChannel): Connect {
  channel.binaryType = "arraybuffer";
  const sockets = new Map<number, VirtualSocket>();
  let next = 1;
  const send = (kind: number, id: number, frame?: Uint8Array) => {
    if (channel.readyState !== "open") return;
    const message = new Uint8Array(3 + (frame?.length ?? 0));
    message[0] = kind;
    message[1] = id >> 8;
    message[2] = id & 0xff;
    if (frame) message.set(frame, 3);
    channel.send(message);
  };
  channel.addEventListener("message", (event: MessageEvent) => {
    const message = new Uint8Array(event.data as ArrayBuffer);
    if (message.length < 3) return;
    const socket = sockets.get((message[1] << 8) | message[2]);
    if (!socket) return;
    if (message[0] === FRAME) socket.receive(message.subarray(3));
    else if (message[0] === CLOSE) socket.closed();
  });
  channel.addEventListener("close", () => {
    for (const socket of sockets.values()) socket.closed();
    sockets.clear();
  });
  return () => {
    const id = next;
    next = next >= 0xffff ? 1 : next + 1;
    const socket = new VirtualSocket(
      (frame) => send(FRAME, id, frame),
      () => {
        sockets.delete(id);
        send(CLOSE, id);
      },
    );
    sockets.set(id, socket);
    send(OPEN, id);
    setTimeout(() => (channel.readyState === "open" ? socket.opened() : socket.closed()), 0);
    return socket;
  };
}

// ----- signalling: an offer and an answer small enough for a QR code -----

interface Compact {
  ufrag: string;
  pwd: string;
  fingerprint: string;
  candidates: [string, number][];
}

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64url(text: string): Uint8Array {
  return Uint8Array.from(atob(text.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
}

/** The parts of a data-channel SDP that differ between sessions, as base64url. */
export function compactDescription(sdp: string): string {
  const line = (name: string) => new RegExp(`^a=${name}:(.*)$`, "m").exec(sdp)?.[1]?.trim() ?? "";
  const fingerprint = line("fingerprint").replace(/^sha-256\s+/i, "");
  const candidates: [string, number][] = [];
  for (const match of sdp.matchAll(/^a=candidate:\S+ 1 udp \d+ (\S+) (\d+) typ host/gim)) {
    candidates.push([match[1], Number(match[2])]);
  }
  const compact = [line("ice-ufrag"), line("ice-pwd"), base64url(Uint8Array.from(fingerprint.split(":"), (h) => parseInt(h, 16))), candidates];
  return base64url(new TextEncoder().encode(JSON.stringify(compact)));
}

function parseCompact(code: string): Compact | null {
  try {
    const [ufrag, pwd, fp, candidates] = JSON.parse(new TextDecoder().decode(fromBase64url(code))) as [string, string, string, [string, number][]];
    const bytes = fromBase64url(fp);
    if (typeof ufrag !== "string" || typeof pwd !== "string" || bytes.length !== 32 || !Array.isArray(candidates)) return null;
    const fingerprint = Array.from(bytes, (b) => b.toString(16).padStart(2, "0").toUpperCase()).join(":");
    return { ufrag, pwd, fingerprint, candidates };
  } catch {
    return null;
  }
}

/** Rebuilds the SDP a compact code came from. */
export function expandDescription(code: string, type: "offer" | "answer"): RTCSessionDescriptionInit | null {
  const c = parseCompact(code);
  if (c === null) return null;
  const lines = [
    "v=0",
    `o=- ${Date.now()} 2 IN IP4 127.0.0.1`,
    "s=-",
    "t=0 0",
    "a=group:BUNDLE 0",
    "a=msid-semantic: WMS",
    `m=application ${c.candidates[0]?.[1] ?? 9} UDP/DTLS/SCTP webrtc-datachannel`,
    "c=IN IP4 0.0.0.0",
    ...c.candidates.map(([address, port], i) => `a=candidate:${i + 1} 1 udp ${2122260223 - i} ${address} ${port} typ host generation 0`),
    `a=ice-ufrag:${c.ufrag}`,
    `a=ice-pwd:${c.pwd}`,
    `a=fingerprint:sha-256 ${c.fingerprint}`,
    `a=setup:${type === "offer" ? "actpass" : "active"}`,
    "a=mid:0",
    "a=sctp-port:5000",
    "a=max-message-size:262144",
  ];
  return { type, sdp: lines.join("\r\n") + "\r\n" };
}

function gathered(pc: RTCPeerConnection, timeoutMs = 4000): Promise<void> {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      pc.removeEventListener("icegatheringstatechange", check);
      resolve();
    };
    const check = () => {
      if (pc.iceGatheringState === "complete") done();
    };
    const timer = setTimeout(done, timeoutMs);
    pc.addEventListener("icegatheringstatechange", check);
  });
}

function opened(channel: RTCDataChannel, pc: RTCPeerConnection, timeoutMs: number): Promise<RTCDataChannel> {
  if (channel.readyState === "open") return Promise.resolve(channel);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("the other player did not connect")), timeoutMs);
    channel.addEventListener("open", () => {
      clearTimeout(timer);
      resolve(channel);
    });
    pc.addEventListener("connectionstatechange", () => {
      if (pc.connectionState === "failed") {
        clearTimeout(timer);
        reject(new Error("the connection failed: are both devices on the same network?"));
      }
    });
  });
}

/** The host's side of one guest: an offer to show, then the guest's answer. */
export class HostInvite {
  readonly pc = new RTCPeerConnection({ iceServers: [] });
  readonly channel = this.pc.createDataChannel("openzh", { ordered: true });
  code = "";

  async create(): Promise<string> {
    await this.pc.setLocalDescription(await this.pc.createOffer());
    await gathered(this.pc);
    this.code = compactDescription(this.pc.localDescription?.sdp ?? "");
    return this.code;
  }

  /** Resolves with the open channel once the guest's answer connects. */
  async accept(answer: string, timeoutMs = 20_000): Promise<RTCDataChannel> {
    const description = expandDescription(answer, "answer");
    if (description === null) throw new Error("that is not a player's answer code");
    await this.pc.setRemoteDescription(description);
    return opened(this.channel, this.pc, timeoutMs);
  }

  close(): void {
    this.pc.close();
  }
}

/** The guest's side: answers the host's offer; the channel opens once the host takes the answer. */
export class GuestAnswer {
  readonly pc = new RTCPeerConnection({ iceServers: [] });
  readonly channel: Promise<RTCDataChannel>;
  private resolveChannel!: (channel: RTCDataChannel) => void;

  constructor() {
    const incoming = new Promise<RTCDataChannel>((resolve) => (this.resolveChannel = resolve));
    this.pc.addEventListener("datachannel", (event) => this.resolveChannel(event.channel));
    this.channel = incoming;
  }

  async answer(offer: string): Promise<string> {
    const description = expandDescription(offer, "offer");
    if (description === null) throw new Error("that is not a host's code");
    await this.pc.setRemoteDescription(description);
    await this.pc.setLocalDescription(await this.pc.createAnswer());
    await gathered(this.pc);
    return compactDescription(this.pc.localDescription?.sdp ?? "");
  }

  /** Resolves once the host has taken the answer and the channel is open. */
  async connected(timeoutMs = 120_000): Promise<RTCDataChannel> {
    const channel = await this.channel;
    return opened(channel, this.pc, timeoutMs);
  }

  close(): void {
    this.pc.close();
  }
}

/** Codes as they travel: the host's offer is a link (`#l=`), the answer a prefixed code. */
export const ANSWER_PREFIX = "OZA1.";

export function offerLink(code: string, origin: string): string {
  return `${origin}/#l=${code}`;
}

export function offerFromText(text: string): string | null {
  return /#l=([A-Za-z0-9_-]+)/.exec(text.trim())?.[1] ?? null;
}

export function answerFromText(text: string): string | null {
  const trimmed = text.trim();
  return trimmed.startsWith(ANSWER_PREFIX) && /^[A-Za-z0-9_-]+$/.test(trimmed.slice(ANSWER_PREFIX.length)) ? trimmed.slice(ANSWER_PREFIX.length) : null;
}
