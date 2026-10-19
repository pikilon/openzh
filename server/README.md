# openzh-server

The multiplayer server. Browsers cannot send UDP, so the engine's UDP layer
(`Core/GameEngine/Source/GameNetwork/udp.cpp`, the `__EMSCRIPTEN__` part)
sends each datagram as a WebSocket frame, and this server forwards it to the
right tab. Each **room** is one virtual LAN: the game's own Network (LAN)
lobby, chat and matches work unchanged inside it.

One binary, two uses:

| Use | How |
| --- | --- |
| LAN party, no internet needed | `openzh-server --static web/out` on one PC. That PC opens `http://localhost:8766`; the others open `https://<its IP>:8765` and accept the self-signed certificate once. |
| Online | Runs on the VPS behind Traefik as `server-openzh.pikilon.com` (`--no-tls`). The site at `openzh.pikilon.com` uses it by default. |

The page picks the relay and room from its URL (`web/src/multiplayer.ts`):
`?room=<name>` joins a private room (up to 32 letters, digits, `-`, `_`);
without it the player is in the relay's open room `lan`.
`?relay=wss://host/GeneralsXLan` points the page at another relay.

## Protocol

Integers are big-endian. The first frame of a socket registers it:
`[1][virtual ip u32][port u16]`. Datagrams are `[2][ip u32][port u16][payload]`:
from the client the address is the destination, from the server the source.
`255.255.255.255` or any `x.x.x.255` reaches every other socket of the room
bound to that port. A socket that falls 8192 frames behind is closed rather
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
