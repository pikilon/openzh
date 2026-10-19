//! One virtual LAN per private room.
//!
//! The engine's UDP layer (Core/GameEngine/Source/GameNetwork/udp.cpp, the
//! `__EMSCRIPTEN__` part) opens one WebSocket per bound UDP port and speaks two
//! frames, all integers big-endian:
//!
//! * `[1][ip u32][port u16]`: registration, the first frame of every socket.
//! * `[2][ip u32][port u16][payload]`: a datagram. From the client the address
//!   is the destination; from the relay it is the source.
//!
//! The destination `255.255.255.255` (what LANAPI broadcasts to) or any
//! `x.x.x.255` reaches every other socket of the room bound to that port.
//!
//! A room exists while it has sockets; the first one sets its token and every
//! later one must bring the same. Port 0 is the page's lease on its virtual
//! address: registering `[1][wanted ip or 0][0]` gets back `[1][ip][0]`, an
//! address no other socket of the room holds, kept while that socket lives.

use std::collections::HashMap;
use std::sync::Mutex;
use std::sync::atomic::{AtomicU64, Ordering};

use bytes::{BufMut, Bytes, BytesMut};
use serde::Serialize;
use tokio::sync::mpsc;

pub const REGISTER: u8 = 1;
pub const PACKET: u8 = 2;
pub const HEADER_LEN: usize = 7;
/// Largest datagram the engine sends is well under this; UDP's own limit.
pub const MAX_PAYLOAD: usize = 65_507;
/// The port of a lease socket.
pub const LEASE_PORT: u16 = 0;
/// Leased addresses are 10.0.0.1 to 10.0.0.254.
const SUBNET: u32 = 0x0A00_0000;

pub type Address = (u32, u16);

#[derive(Clone, Copy, Debug)]
pub struct Limits {
    pub max_rooms: usize,
    pub max_sockets_per_room: usize,
    /// Frames waiting for one socket. A socket that falls this far behind is
    /// dropped: losing frames silently would leave the lockstep waiting forever.
    pub queue: usize,
}

impl Default for Limits {
    fn default() -> Self {
        Self { max_rooms: 2_000, max_sockets_per_room: 64, queue: 8_192 }
    }
}

#[derive(Debug, PartialEq, Eq)]
pub enum JoinError {
    TooManyRooms,
    RoomFull,
    WrongToken,
}

/// A registered socket; give it back to [`Relay::leave`].
#[derive(Debug)]
pub struct Membership {
    pub room: String,
    pub address: Address,
    id: u64,
}

struct Socket {
    id: u64,
    tx: mpsc::Sender<Bytes>,
}

struct Room {
    token: String,
    sockets: HashMap<Address, Socket>,
}

#[derive(Default)]
pub struct Relay {
    rooms: Mutex<HashMap<String, Room>>,
    next_id: AtomicU64,
    packets: AtomicU64,
    bytes: AtomicU64,
    pub limits: Limits,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct Stats {
    pub rooms: usize,
    pub sockets: usize,
    pub packets: u64,
    pub bytes: u64,
}

/// Parses a registration frame.
pub fn parse_registration(frame: &[u8]) -> Option<Address> {
    if frame.len() != HEADER_LEN || frame[0] != REGISTER {
        return None;
    }
    Some(read_address(frame))
}

/// The answer to a lease: the same frame with the granted address.
pub fn registration(address: Address) -> Bytes {
    let mut out = BytesMut::with_capacity(HEADER_LEN);
    out.put_u8(REGISTER);
    out.put_u32(address.0);
    out.put_u16(address.1);
    out.freeze()
}

/// Room names come from the invite link: short, lowercase, URL-safe.
pub fn room_name(raw: Option<&str>) -> Option<String> {
    let name = raw.map(str::trim).filter(|s| !s.is_empty())?.to_ascii_lowercase();
    let valid = name.len() <= 32 && name.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_');
    valid.then_some(name)
}

/// Tokens are the room's secret, also from the link: 16 to 64 base64url characters.
pub fn room_token(raw: Option<&str>) -> Option<String> {
    let token = raw?;
    let valid = (16..=64).contains(&token.len()) && token.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_');
    valid.then(|| token.to_owned())
}

fn read_address(frame: &[u8]) -> Address {
    let ip = u32::from_be_bytes([frame[1], frame[2], frame[3], frame[4]]);
    let port = u16::from_be_bytes([frame[5], frame[6]]);
    (ip, port)
}

fn is_broadcast(ip: u32) -> bool {
    ip & 0xFF == 0xFF
}

fn leasable(ip: u32) -> bool {
    ip & 0xFFFF_FF00 == SUBNET && !matches!(ip & 0xFF, 0 | 0xFF)
}

impl Relay {
    pub fn new(limits: Limits) -> Self {
        Self { limits, ..Self::default() }
    }

    /// False when the room exists with another token: the page is refused
    /// before the WebSocket opens.
    pub fn admits(&self, room: &str, token: &str) -> bool {
        self.rooms.lock().unwrap().get(room).is_none_or(|r| r.token == token)
    }

    /// Registers a socket. A lease (port [`LEASE_PORT`]) gets the address it
    /// asks for when free, else the lowest free one. Any other socket keeps the
    /// address it registers with; one already registered there (the same tab
    /// reopening its port) is replaced and closed.
    pub fn join(&self, room: &str, token: &str, address: Address, tx: mpsc::Sender<Bytes>) -> Result<Membership, JoinError> {
        let mut rooms = self.rooms.lock().unwrap();
        if !rooms.contains_key(room) && rooms.len() >= self.limits.max_rooms {
            return Err(JoinError::TooManyRooms);
        }
        let entry = rooms.entry(room.to_owned()).or_insert_with(|| Room { token: token.to_owned(), sockets: HashMap::new() });
        if entry.token != token {
            return Err(JoinError::WrongToken);
        }
        let sockets = &mut entry.sockets;
        let address = if address.1 == LEASE_PORT {
            let taken = |ip: u32| sockets.keys().any(|a| a.0 == ip);
            let ip = Some(address.0)
                .filter(|ip| leasable(*ip) && !taken(*ip))
                .or_else(|| (1..0xFF).map(|n| SUBNET | n).find(|ip| !taken(*ip)));
            match ip {
                Some(ip) => (ip, LEASE_PORT),
                None => return Err(Self::refuse(&mut rooms, room, JoinError::RoomFull)),
            }
        } else {
            address
        };
        let sockets = &mut rooms.get_mut(room).unwrap().sockets;
        if !sockets.contains_key(&address) && sockets.len() >= self.limits.max_sockets_per_room {
            return Err(Self::refuse(&mut rooms, room, JoinError::RoomFull));
        }
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        if sockets.insert(address, Socket { id, tx }).is_some() {
            tracing::info!(room, ip = %ip_text(address.0), port = address.1, "address taken over");
        }
        Ok(Membership { room: room.to_owned(), address, id })
    }

    /// Drops a room this join just created and could not fill.
    fn refuse(rooms: &mut HashMap<String, Room>, room: &str, error: JoinError) -> JoinError {
        if rooms.get(room).is_some_and(|r| r.sockets.is_empty()) {
            rooms.remove(room);
        }
        error
    }

    pub fn leave(&self, member: &Membership) {
        let mut rooms = self.rooms.lock().unwrap();
        if let Some(entry) = rooms.get_mut(&member.room) {
            if entry.sockets.get(&member.address).is_some_and(|s| s.id == member.id) {
                entry.sockets.remove(&member.address);
            }
            if entry.sockets.is_empty() {
                rooms.remove(&member.room);
            }
        }
    }

    /// Forwards one datagram frame from `from`. Malformed frames are ignored,
    /// as a UDP socket would.
    pub fn route(&self, from: &Membership, frame: &[u8]) {
        if frame.len() < HEADER_LEN || frame.len() > HEADER_LEN + MAX_PAYLOAD || frame[0] != PACKET {
            return;
        }
        let (dest_ip, dest_port) = read_address(frame);
        if dest_port == LEASE_PORT {
            return;
        }
        let mut out = BytesMut::with_capacity(frame.len());
        out.put_u8(PACKET);
        out.put_u32(from.address.0);
        out.put_u16(from.address.1);
        out.put_slice(&frame[HEADER_LEN..]);
        let out = out.freeze();

        let targets: Vec<(Address, u64, mpsc::Sender<Bytes>)> = {
            let rooms = self.rooms.lock().unwrap();
            let Some(entry) = rooms.get(&from.room) else { return };
            let sockets = &entry.sockets;
            if is_broadcast(dest_ip) {
                sockets
                    .iter()
                    .filter(|(addr, _)| addr.1 == dest_port && **addr != from.address)
                    .map(|(addr, s)| (*addr, s.id, s.tx.clone()))
                    .collect()
            } else {
                sockets.get(&(dest_ip, dest_port)).map(|s| ((dest_ip, dest_port), s.id, s.tx.clone())).into_iter().collect()
            }
        };

        for (address, id, tx) in targets {
            match tx.try_send(out.clone()) {
                Ok(()) => {
                    self.packets.fetch_add(1, Ordering::Relaxed);
                    self.bytes.fetch_add(out.len() as u64, Ordering::Relaxed);
                }
                Err(mpsc::error::TrySendError::Full(_)) => {
                    tracing::warn!(room = from.room, ip = %ip_text(address.0), port = address.1, "socket too slow, dropped");
                    self.leave(&Membership { room: from.room.clone(), address, id });
                }
                Err(mpsc::error::TrySendError::Closed(_)) => {}
            }
        }
    }

    pub fn stats(&self) -> Stats {
        let rooms = self.rooms.lock().unwrap();
        Stats {
            rooms: rooms.len(),
            sockets: rooms.values().map(|r| r.sockets.len()).sum(),
            packets: self.packets.load(Ordering::Relaxed),
            bytes: self.bytes.load(Ordering::Relaxed),
        }
    }
}

pub fn ip_text(ip: u32) -> String {
    std::net::Ipv4Addr::from(ip).to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    const A: Address = (0x0A00_0001, 8086);
    const B: Address = (0x0A00_0002, 8086);
    const C: Address = (0x0A00_0003, 8086);

    fn frame(kind: u8, (ip, port): Address, payload: &[u8]) -> Vec<u8> {
        let mut f = vec![kind];
        f.extend(ip.to_be_bytes());
        f.extend(port.to_be_bytes());
        f.extend(payload);
        f
    }

    const TOKEN: &str = "0123456789abcdef";

    fn join(relay: &Relay, room: &str, address: Address) -> (Membership, mpsc::Receiver<Bytes>) {
        let (tx, rx) = mpsc::channel(4);
        (relay.join(room, TOKEN, address, tx).unwrap(), rx)
    }

    #[test]
    fn unicast_rewrites_the_source() {
        let relay = Relay::default();
        let (a, _ra) = join(&relay, "r", A);
        let (_b, mut rb) = join(&relay, "r", B);
        relay.route(&a, &frame(PACKET, B, b"hi"));
        assert_eq!(rb.try_recv().unwrap().as_ref(), frame(PACKET, A, b"hi"));
    }

    #[test]
    fn broadcast_reaches_the_room_on_that_port_but_not_the_sender() {
        let relay = Relay::default();
        let (a, mut ra) = join(&relay, "r", A);
        let (_b, mut rb) = join(&relay, "r", B);
        let (_c, mut rc) = join(&relay, "r", (C.0, 9999));
        let (_d, mut rd) = join(&relay, "other", C);
        relay.route(&a, &frame(PACKET, (u32::MAX, 8086), b"lobby"));
        assert_eq!(rb.try_recv().unwrap().as_ref(), frame(PACKET, A, b"lobby"));
        assert!(ra.try_recv().is_err());
        assert!(rc.try_recv().is_err());
        assert!(rd.try_recv().is_err());
    }

    #[test]
    fn subnet_broadcast_counts_as_broadcast() {
        let relay = Relay::default();
        let (a, _ra) = join(&relay, "r", A);
        let (_b, mut rb) = join(&relay, "r", B);
        relay.route(&a, &frame(PACKET, (0x0A00_00FF, 8086), b"x"));
        assert!(rb.try_recv().is_ok());
    }

    #[test]
    fn malformed_frames_are_ignored() {
        let relay = Relay::default();
        let (a, _ra) = join(&relay, "r", A);
        let (_b, mut rb) = join(&relay, "r", B);
        relay.route(&a, &[PACKET, 1, 2]);
        relay.route(&a, &frame(REGISTER, B, b"x"));
        relay.route(&a, &frame(PACKET, B, &vec![0; MAX_PAYLOAD + 1]));
        assert!(rb.try_recv().is_err());
    }

    #[test]
    fn rejoining_replaces_and_closes_the_old_socket() {
        let relay = Relay::default();
        let (old, mut r_old) = join(&relay, "r", A);
        let (_new, _r_new) = join(&relay, "r", A);
        assert!(matches!(r_old.try_recv(), Err(mpsc::error::TryRecvError::Disconnected)));
        relay.leave(&old); // must not remove the new one
        assert_eq!(relay.stats().sockets, 1);
    }

    #[test]
    fn a_slow_socket_is_dropped() {
        let relay = Relay::default();
        let (a, _ra) = join(&relay, "r", A);
        let (_b, mut rb) = join(&relay, "r", B);
        for _ in 0..5 {
            relay.route(&a, &frame(PACKET, B, b"x"));
        }
        assert_eq!(relay.stats().sockets, 1);
        for _ in 0..4 {
            rb.try_recv().unwrap();
        }
        assert!(matches!(rb.try_recv(), Err(mpsc::error::TryRecvError::Disconnected)));
    }

    #[test]
    fn limits_and_cleanup() {
        let relay = Relay::new(Limits { max_rooms: 1, max_sockets_per_room: 1, queue: 4 });
        let (a, _ra) = join(&relay, "r", A);
        let (tx, _rx) = mpsc::channel(1);
        assert_eq!(relay.join("r", TOKEN, B, tx.clone()).unwrap_err(), JoinError::RoomFull);
        assert_eq!(relay.join("s", TOKEN, B, tx).unwrap_err(), JoinError::TooManyRooms);
        relay.leave(&a);
        assert_eq!(relay.stats(), Stats { rooms: 0, sockets: 0, packets: 0, bytes: 0 });
    }

    #[test]
    fn the_first_socket_sets_the_token() {
        let relay = Relay::default();
        let (_a, _ra) = join(&relay, "r", A);
        let (tx, _rx) = mpsc::channel(1);
        assert!(relay.admits("r", TOKEN));
        assert!(!relay.admits("r", "fedcba9876543210"));
        assert!(relay.admits("new", "fedcba9876543210"));
        assert_eq!(relay.join("r", "fedcba9876543210", B, tx).unwrap_err(), JoinError::WrongToken);
        assert_eq!(relay.stats().sockets, 1);
    }

    #[test]
    fn leases_hand_out_free_addresses() {
        let relay = Relay::default();
        let (first, _r1) = join(&relay, "r", (0, LEASE_PORT));
        assert_eq!(first.address, (SUBNET | 1, LEASE_PORT));
        // An engine socket already on .2 keeps it from the next lease.
        let (_engine, _re) = join(&relay, "r", (SUBNET | 2, 8086));
        let (second, _r2) = join(&relay, "r", (0, LEASE_PORT));
        assert_eq!(second.address.0, SUBNET | 3);
        // A wanted address is granted when free, replaced when taken or outside the subnet.
        let (wanted, _r3) = join(&relay, "r", (SUBNET | 77, LEASE_PORT));
        assert_eq!(wanted.address.0, SUBNET | 77);
        let (clash, _r4) = join(&relay, "r", (SUBNET | 77, LEASE_PORT));
        assert_eq!(clash.address.0, SUBNET | 4);
        let (outside, _r5) = join(&relay, "r", (0xC0A8_0001, LEASE_PORT));
        assert_eq!(outside.address.0, SUBNET | 5);
        // Another room has its own addresses.
        let (other, _r6) = join(&relay, "s", (0, LEASE_PORT));
        assert_eq!(other.address.0, SUBNET | 1);
        // A freed address goes back to the pool.
        relay.leave(&first);
        let (again, _r7) = join(&relay, "r", (0, LEASE_PORT));
        assert_eq!(again.address.0, SUBNET | 1);
    }

    #[test]
    fn nothing_routes_to_a_lease() {
        let relay = Relay::default();
        let (a, _ra) = join(&relay, "r", A);
        let (_lease, mut rl) = join(&relay, "r", (0, LEASE_PORT));
        relay.route(&a, &frame(PACKET, (u32::MAX, LEASE_PORT), b"x"));
        relay.route(&a, &frame(PACKET, (SUBNET | 1, LEASE_PORT), b"x"));
        assert!(rl.try_recv().is_err());
    }

    #[test]
    fn room_names_and_tokens() {
        assert_eq!(room_name(None), None);
        assert_eq!(room_name(Some(" ")), None);
        assert_eq!(room_token(None), None);
        assert_eq!(room_token(Some("short")), None);
        assert_eq!(room_token(Some("0123456789abcdef/")), None);
        assert_eq!(room_token(Some(&"t".repeat(65))), None);
        assert_eq!(room_token(Some("Abc-_0123456789xyz")).as_deref(), Some("Abc-_0123456789xyz"));
        assert_eq!(room_name(Some("Mi-Sala_1")).as_deref(), Some("mi-sala_1"));
        assert_eq!(room_name(Some("a/b")), None);
        assert_eq!(room_name(Some(&"x".repeat(33))), None);
    }

    #[test]
    fn registration() {
        assert_eq!(parse_registration(&frame(REGISTER, A, b"")), Some(A));
        assert_eq!(parse_registration(&frame(PACKET, A, b"")), None);
        assert_eq!(parse_registration(&frame(REGISTER, A, b"x")), None);
    }
}
