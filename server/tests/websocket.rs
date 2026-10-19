//! Two clients speaking udp.cpp's frames through a real listener.

use std::sync::Arc;
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use openzh_server::relay::{Limits, PACKET, REGISTER, Relay};
use openzh_server::{RELAY_PATH, app};
use tokio_tungstenite::tungstenite::Message;

type Client = tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>;

fn frame(kind: u8, ip: u32, port: u16, payload: &[u8]) -> Vec<u8> {
    let mut f = vec![kind];
    f.extend(ip.to_be_bytes());
    f.extend(port.to_be_bytes());
    f.extend(payload);
    f
}

async fn server() -> (String, Arc<Relay>) {
    let relay = Arc::new(Relay::new(Limits::default()));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(axum::serve(listener, app(relay.clone(), None)).into_future());
    (format!("ws://{addr}{RELAY_PATH}"), relay)
}

async fn client(url: &str, room: &str, ip: u32, port: u16) -> Client {
    let (mut ws, _) = tokio_tungstenite::connect_async(format!("{url}?room={room}")).await.unwrap();
    ws.send(Message::binary(frame(REGISTER, ip, port, b""))).await.unwrap();
    ws
}

async fn next_binary(ws: &mut Client) -> Vec<u8> {
    loop {
        let message = tokio::time::timeout(Duration::from_secs(5), ws.next()).await.unwrap().unwrap().unwrap();
        if let Message::Binary(b) = message {
            return b.to_vec();
        }
    }
}

async fn settle(relay: &Relay, sockets: usize) {
    for _ in 0..100 {
        if relay.stats().sockets == sockets {
            return;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    panic!("expected {sockets} sockets, have {:?}", relay.stats());
}

#[tokio::test]
async fn lobby_broadcast_then_direct_reply() {
    let (url, relay) = server().await;
    let mut host = client(&url, "Sala1", 0x0A00_0001, 8086).await;
    let mut guest = client(&url, "sala1", 0x0A00_0002, 8086).await;
    let mut stranger = client(&url, "otra", 0x0A00_0003, 8086).await;
    settle(&relay, 3).await;

    host.send(Message::binary(frame(PACKET, u32::MAX, 8086, b"game here"))).await.unwrap();
    assert_eq!(next_binary(&mut guest).await, frame(PACKET, 0x0A00_0001, 8086, b"game here"));

    guest.send(Message::binary(frame(PACKET, 0x0A00_0001, 8086, b"join"))).await.unwrap();
    assert_eq!(next_binary(&mut host).await, frame(PACKET, 0x0A00_0002, 8086, b"join"));

    let nothing = tokio::time::timeout(Duration::from_millis(200), next_binary(&mut stranger)).await;
    assert!(nothing.is_err(), "another room got {nothing:?}");

    drop(guest);
    settle(&relay, 2).await;
    let _ = stranger.close(None).await;
}

#[tokio::test]
async fn bad_room_is_refused() {
    let (url, _) = server().await;
    assert!(tokio_tungstenite::connect_async(format!("{url}?room=a%2Fb")).await.is_err());
}

#[tokio::test]
async fn health_and_cross_origin_isolation_headers() {
    let (url, _) = server().await;
    let addr = url.trim_start_matches("ws://").split('/').next().unwrap().to_owned();
    let mut stream = tokio::net::TcpStream::connect(&addr).await.unwrap();
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    stream.write_all(format!("GET /health HTTP/1.1\r\nHost: {addr}\r\nConnection: close\r\n\r\n").as_bytes()).await.unwrap();
    let mut response = String::new();
    stream.read_to_string(&mut response).await.unwrap();
    assert!(response.starts_with("HTTP/1.1 200"), "{response}");
    assert!(response.contains("cross-origin-embedder-policy: require-corp"));
    assert!(response.ends_with("ok"));
}
