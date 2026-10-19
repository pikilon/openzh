// Online games by invite (docs: the OpenZH multiplayer design). Rooms are
// private: the host's launcher makes a random room and token on a relay
// (server/), and the invite link carries them in its fragment, which never
// reaches a server: https://openzh.pikilon.com/#j=<base64url JSON>.
//
// The engine reads these globals (Core/.../GameNetwork/udp.cpp,
// LanLobbyMenu.cpp, MainMenu.cpp):
//   generalsXLanRelay, generalsXLanRoom, generalsXLanToken  where its LAN sockets go
//   generalsXLanVirtualIP  this tab's address in the room, leased from the relay
//   generalsXPlayerName    the lobby name, instead of Player<n>
//   generalsXLanAction     "host" or "join": the shell opens the LAN lobby and
//                          creates or joins the game; the engine clears it
//
// `?relay=<wss url>` makes the host's invite use another relay.

/** The online relay. */
export const ONLINE_RELAY = "wss://server-openzh.pikilon.com/GeneralsXLan";

export interface Invite {
  transport: "relay";
  relay: string;
  room: string;
  token: string;
  host: string;
}

export interface LanGlobals {
  generalsXLanRelay?: string;
  generalsXLanRoom?: string;
  generalsXLanToken?: string;
  generalsXLanVirtualIP?: number;
  generalsXPlayerName?: string;
  generalsXLanAction?: "host" | "join";
}

const NAME_KEY = "openzh.playerName";
/** The lobby's own limit (g_lanPlayerNameLength). */
export const NAME_LENGTH = 12;

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64url(text: string): Uint8Array {
  const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

function randomText(bytes: number): string {
  return base64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

/** A new private room on `relay`: the relay's room names are lowercase. */
export function newInvite(relay: string, host: string): Invite {
  const room = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => (b % 36).toString(36)).join("");
  return { transport: "relay", relay, room, token: randomText(16), host };
}

export function encodeInvite(invite: Invite): string {
  const payload = { v: 1, t: invite.transport, u: invite.relay, r: invite.room, k: invite.token, h: invite.host };
  return base64url(new TextEncoder().encode(JSON.stringify(payload)));
}

export function inviteLink(invite: Invite, origin: string): string {
  return `${origin}/#j=${encodeInvite(invite)}`;
}

/** The invite in a `#j=` fragment, or null for none or a broken one. */
export function readInvite(hash: string): Invite | null {
  const match = /^#?j=([A-Za-z0-9_-]+)$/.exec(hash);
  if (match === null) return null;
  try {
    const p = JSON.parse(new TextDecoder().decode(fromBase64url(match[1]))) as Record<string, unknown>;
    const ok =
      p.v === 1 &&
      p.t === "relay" &&
      typeof p.u === "string" &&
      /^wss?:\/\//.test(p.u) &&
      typeof p.r === "string" &&
      /^[a-z0-9_-]{1,32}$/.test(p.r) &&
      typeof p.k === "string" &&
      /^[A-Za-z0-9_-]{16,64}$/.test(p.k);
    if (!ok) return null;
    return { transport: "relay", relay: p.u as string, room: p.r as string, token: p.k as string, host: typeof p.h === "string" ? p.h : "" };
  } catch {
    return null;
  }
}

/** The relay a host's invite uses on this page. */
export function hostRelay(location: Pick<Location, "search">): string {
  return new URLSearchParams(location.search).get("relay") || ONLINE_RELAY;
}

/** A name the lobby accepts: it splits its messages on `,` `:` `;`. */
export function cleanName(raw: string): string {
  return Array.from(raw.replace(/[,:;]/g, "").trim()).slice(0, NAME_LENGTH).join("").trim();
}

export function readPlayerName(): string {
  try {
    return cleanName(window.localStorage.getItem(NAME_KEY) ?? "");
  } catch {
    return "";
  }
}

export function writePlayerName(name: string): void {
  try {
    window.localStorage.setItem(NAME_KEY, name);
  } catch {
    // The name still applies to this page.
  }
}

function roomUrl(invite: Invite): string {
  const separator = invite.relay.includes("?") ? "&" : "?";
  return `${invite.relay}${separator}room=${encodeURIComponent(invite.room)}&token=${encodeURIComponent(invite.token)}`;
}

/**
 * The tab's address in the room. The relay keeps it while this socket is
 * open (server/src/relay.rs, port 0); a dropped socket asks for the same one
 * again, so the engine's sockets keep a valid address.
 */
export class Lease {
  ip = 0;
  private socket: WebSocket | null = null;
  private closed = false;

  constructor(private readonly invite: Invite) {}

  /** Resolves with the leased address, rejects when the relay refuses the room. */
  open(timeoutMs = 10_000): Promise<number> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(roomUrl(this.invite));
      socket.binaryType = "arraybuffer";
      this.socket = socket;
      let settled = false;
      const timer = setTimeout(() => fail(new Error("the game server did not answer")), timeoutMs);
      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        socket.close();
        reject(error);
      };
      socket.addEventListener("open", () => {
        const frame = new DataView(new ArrayBuffer(7));
        frame.setUint8(0, 1);
        frame.setUint32(1, this.ip, false);
        frame.setUint16(5, 0, false);
        socket.send(frame.buffer);
      });
      socket.addEventListener("message", (event) => {
        const view = new DataView(event.data as ArrayBuffer);
        if (settled || view.byteLength !== 7 || view.getUint8(0) !== 1) return;
        settled = true;
        clearTimeout(timer);
        this.ip = view.getUint32(1, false);
        resolve(this.ip);
      });
      socket.addEventListener("close", () => {
        if (!settled) {
          fail(new Error("the game server refused the room (the link may be wrong or the game over)"));
          return;
        }
        if (this.closed || this.socket !== socket) return;
        // Keep the address: reconnect with it while the page lives.
        setTimeout(() => {
          if (!this.closed) this.open().catch(() => undefined);
        }, 2_000);
      });
    });
  }

  close(): void {
    this.closed = true;
    this.socket?.close();
  }
}

/** Points the engine at the invite's room as `ip`, and asks it to host or join. */
export function applyInvite(invite: Invite, ip: number, name: string, action: "host" | "join", target: LanGlobals = globalThis as LanGlobals): void {
  target.generalsXLanRelay = invite.relay;
  target.generalsXLanRoom = invite.room;
  target.generalsXLanToken = invite.token;
  target.generalsXLanVirtualIP = ip >>> 0;
  target.generalsXPlayerName = name;
  target.generalsXLanAction = action;
}

/** The player's name for the engine, before any invite. */
export function configureMultiplayer(target: LanGlobals = globalThis as LanGlobals): void {
  const name = readPlayerName();
  if (name !== "") target.generalsXPlayerName = name;
}
