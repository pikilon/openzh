//! A STUN binding responder (RFC 8489), so browsers learn their public
//! address for direct WebRTC links between players without asking a third
//! party. It answers binding requests only, with XOR-MAPPED-ADDRESS, and its
//! answer is barely larger than the request.

use std::net::{IpAddr, SocketAddr};

use tokio::net::UdpSocket;

const BINDING_REQUEST: u16 = 0x0001;
const BINDING_SUCCESS: u16 = 0x0101;
const MAGIC_COOKIE: u32 = 0x2112_A442;
const XOR_MAPPED_ADDRESS: u16 = 0x0020;
const HEADER_LEN: usize = 20;

/// The answer to a binding request from `from`, or None for anything else.
pub fn answer(request: &[u8], from: SocketAddr) -> Option<Vec<u8>> {
    if request.len() < HEADER_LEN || request.len() > 548 {
        return None;
    }
    let kind = u16::from_be_bytes([request[0], request[1]]);
    let length = u16::from_be_bytes([request[2], request[3]]) as usize;
    let cookie = u32::from_be_bytes([request[4], request[5], request[6], request[7]]);
    if kind != BINDING_REQUEST || cookie != MAGIC_COOKIE || HEADER_LEN + length != request.len() || !length.is_multiple_of(4) {
        return None;
    }
    let transaction = &request[8..20];

    let mut value = vec![0u8, 0];
    let port = from.port() ^ (MAGIC_COOKIE >> 16) as u16;
    match from.ip() {
        IpAddr::V4(ip) => {
            value[1] = 0x01;
            value.extend(port.to_be_bytes());
            value.extend((u32::from(ip) ^ MAGIC_COOKIE).to_be_bytes());
        }
        IpAddr::V6(ip) => {
            value[1] = 0x02;
            value.extend(port.to_be_bytes());
            let mut key = MAGIC_COOKIE.to_be_bytes().to_vec();
            key.extend(transaction);
            value.extend(ip.octets().iter().zip(key).map(|(a, b)| a ^ b));
        }
    }

    let mut out = Vec::with_capacity(HEADER_LEN + 4 + value.len());
    out.extend(BINDING_SUCCESS.to_be_bytes());
    out.extend(((4 + value.len()) as u16).to_be_bytes());
    out.extend(MAGIC_COOKIE.to_be_bytes());
    out.extend(transaction);
    out.extend(XOR_MAPPED_ADDRESS.to_be_bytes());
    out.extend((value.len() as u16).to_be_bytes());
    out.extend(value);
    Some(out)
}

pub async fn serve(socket: UdpSocket) -> std::io::Result<()> {
    let mut buffer = [0u8; 1500];
    loop {
        let (len, from) = socket.recv_from(&mut buffer).await?;
        if let Some(reply) = answer(&buffer[..len], from) {
            let _ = socket.send_to(&reply, from).await;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(extra: &[u8]) -> Vec<u8> {
        let mut r = vec![0x00, 0x01];
        r.extend((extra.len() as u16).to_be_bytes());
        r.extend(MAGIC_COOKIE.to_be_bytes());
        r.extend(1u8..=12);
        r.extend(extra);
        r
    }

    #[test]
    fn answers_with_the_xored_address() {
        let reply = answer(&request(&[]), "203.0.113.7:54321".parse().unwrap()).unwrap();
        assert_eq!(&reply[0..2], &[0x01, 0x01]);
        assert_eq!(u16::from_be_bytes([reply[2], reply[3]]), 12);
        assert_eq!(&reply[8..20], &(1u8..=12).collect::<Vec<_>>()[..]);
        assert_eq!(&reply[20..24], &[0x00, 0x20, 0x00, 0x08]);
        assert_eq!(reply[25], 0x01);
        assert_eq!(u16::from_be_bytes([reply[26], reply[27]]) ^ 0x2112, 54321);
        let ip = u32::from_be_bytes([reply[28], reply[29], reply[30], reply[31]]) ^ MAGIC_COOKIE;
        assert_eq!(std::net::Ipv4Addr::from(ip), "203.0.113.7".parse::<std::net::Ipv4Addr>().unwrap());
    }

    #[test]
    fn answers_ipv6_and_requests_with_attributes() {
        let from: SocketAddr = "[2001:db8::1]:3000".parse().unwrap();
        let reply = answer(&request(&[0x80, 0x28, 0x00, 0x04, 1, 2, 3, 4]), from).unwrap();
        assert_eq!(reply[25], 0x02);
        assert_eq!(reply.len(), 20 + 4 + 20);
    }

    #[test]
    fn ignores_everything_else() {
        let from: SocketAddr = "203.0.113.7:1".parse().unwrap();
        assert!(answer(&[0; 10], from).is_none());
        let mut wrong_kind = request(&[]);
        wrong_kind[1] = 0x11;
        assert!(answer(&wrong_kind, from).is_none());
        let mut wrong_cookie = request(&[]);
        wrong_cookie[4] = 0;
        assert!(answer(&wrong_cookie, from).is_none());
        let mut wrong_length = request(&[]);
        wrong_length[3] = 4;
        assert!(answer(&wrong_length, from).is_none());
    }
}
