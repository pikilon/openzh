# openzh-server

The multiplayer server. Browsers cannot send UDP, so the engine's UDP layer
(`Core/GameEngine/Source/GameNetwork/udp.cpp`, the `__EMSCRIPTEN__` part)
sends each datagram as a WebSocket frame, and this server forwards it to the
right tab. Each **room** is one virtual LAN: the game's own Network (LAN)
lobby, chat and matches work unchanged inside it.

It runs on the VPS behind Traefik as `server-openzh.pikilon.com`; the site at
`openzh.pikilon.com` uses it for online games. Games on a network without
internet need no server: the host's tab is the relay and the others connect
to it over WebRTC (`web/src/lan.ts`).

Rooms are private. The WebSocket URL must carry `?room=<name>&token=<secret>`
(room: up to 32 letters, digits, `-`, `_`; token: 16 to 64 of those): the
first socket of a room sets its token, any other token is refused with 403,
and a missing room or token with 400. The page gets both from an invite link
(`web/src/multiplayer.ts`): the host's launcher makes a random room and token.

## Protocol

Integers are big-endian. The first frame of a socket registers it:
`[1][virtual ip u32][port u16]`. Datagrams are `[2][ip u32][port u16][payload]`:
from the client the address is the destination, from the server the source.
`255.255.255.255` or any `x.x.x.255` reaches every other socket of the room
bound to that port.

Port 0 is a lease on the page's virtual address, taken before the engine opens
any socket: `[1][wanted ip or 0][0]` is answered with `[1][ip][0]`, the wanted
address when no socket of the room holds it, else the lowest free one in
`10.0.0.1`-`10.0.0.254`. The address stays the page's while that socket is
open, so two players of a room never share one. A socket that falls 8192 frames behind is closed rather
than silently losing frames, which would stall the lockstep.

`GET /health` answers `ok`; `GET /stats` gives rooms, sockets, packets and bytes.

## Build, test, deploy

```bash
cargo test
cargo build --release          # target/release/openzh-server, about 2 MB
server/deploy/deploy.sh        # builds on the VPS and restarts the `openzh` compose project
```

`deploy.sh` needs the SSH alias `pikilon-vps` (root on the VPS, key
`~/.ssh/openzh_vps`). The VPS hosts other backends too: each is its own
compose project under `/docker/<name>` with Traefik labels for its subdomain.
