// Where the engine's LAN sockets go. udp.cpp (GeneralsXWebLanBind) reads
// these globals when the game opens a socket; without them it looks for the
// relay of a LAN party server (server/) on the page's own host.
//
// Query parameters:
//   relay=<wss url>  another relay, e.g. a local server while playing online
//   room=<name>      the virtual LAN to join on that relay; none is the
//                    relay's open room, where every player sees every game

/** The online relay for the published site. */
export const ONLINE_RELAY = "wss://server-openzh.pikilon.com/GeneralsXLan";
const ONLINE_HOSTS = new Set(["openzh.pikilon.com"]);

export interface MultiplayerTarget {
  generalsXLanRelay?: string;
  generalsXLanRoom?: string;
}

export function multiplayerSettings(location: Pick<Location, "hostname" | "search">): MultiplayerTarget {
  const params = new URLSearchParams(location.search);
  const relay = params.get("relay") || (ONLINE_HOSTS.has(location.hostname) ? ONLINE_RELAY : undefined);
  const room = params.get("room")?.trim() || undefined;
  return { generalsXLanRelay: relay, generalsXLanRoom: room };
}

export function configureMultiplayer(target: MultiplayerTarget = globalThis as MultiplayerTarget): void {
  Object.assign(target, multiplayerSettings(window.location));
}
