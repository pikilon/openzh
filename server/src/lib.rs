//! OpenZH multiplayer server: the WebSocket relay that stands in for UDP.

pub mod relay;
pub mod stun;

use std::sync::Arc;
use std::time::Duration;

use axum::Router;
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Query, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use futures_util::{SinkExt, StreamExt};
use serde::Deserialize;
use tokio::sync::mpsc;

use relay::{HEADER_LEN, MAX_PAYLOAD, Relay};

/// The path udp.cpp connects to.
pub const RELAY_PATH: &str = "/GeneralsXLan";

const REGISTRATION_TIMEOUT: Duration = Duration::from_secs(10);
/// Browsers answer pings below JavaScript, so a tab busy loading a map still
/// answers; a socket silent for longer than this is dead.
const PING_EVERY: Duration = Duration::from_secs(20);
const SILENCE_LIMIT: Duration = Duration::from_secs(75);

#[derive(Deserialize)]
struct RelayQuery {
    room: Option<String>,
    token: Option<String>,
}

/// The whole HTTP surface.
pub fn app(relay: Arc<Relay>) -> Router {
    Router::new()
        .route(RELAY_PATH, get(upgrade))
        .route("/health", get(|| async { "ok" }))
        .route("/stats", get(|State(relay): State<Arc<Relay>>| async move { axum::Json(relay.stats()) }))
        .with_state(relay)
}

async fn upgrade(ws: WebSocketUpgrade, Query(query): Query<RelayQuery>, State(relay): State<Arc<Relay>>) -> Response {
    // Rooms are private: only an invite link's room and token get in.
    let Some(room) = relay::room_name(query.room.as_deref()) else {
        return (StatusCode::BAD_REQUEST, "room: up to 32 letters, digits, - or _").into_response();
    };
    let Some(token) = relay::room_token(query.token.as_deref()) else {
        return (StatusCode::BAD_REQUEST, "token: 16 to 64 letters, digits, - or _").into_response();
    };
    if !relay.admits(&room, &token) {
        return (StatusCode::FORBIDDEN, "wrong token for this room").into_response();
    }
    ws.max_message_size(HEADER_LEN + MAX_PAYLOAD)
        .on_upgrade(move |socket| connection(socket, relay, room, token))
}

async fn connection(socket: WebSocket, relay: Arc<Relay>, room: String, token: String) {
    let (mut sink, mut stream) = socket.split();

    let first = tokio::time::timeout(REGISTRATION_TIMEOUT, stream.next()).await;
    let Ok(Some(Ok(Message::Binary(first)))) = first else { return };
    let Some(address) = relay::parse_registration(&first) else { return };

    let (tx, mut rx) = mpsc::channel(relay.limits.queue);
    let member = match relay.join(&room, &token, address, tx) {
        Ok(member) => member,
        Err(error) => {
            tracing::warn!(room, ?error, "join refused");
            let _ = sink.close().await;
            return;
        }
    };
    let address = member.address;
    tracing::debug!(room, ip = %relay::ip_text(address.0), port = address.1, "joined");
    if address.1 == relay::LEASE_PORT && sink.send(Message::Binary(relay::registration(address))).await.is_err() {
        relay.leave(&member);
        return;
    }

    let writer = async {
        let mut ping = tokio::time::interval_at(tokio::time::Instant::now() + PING_EVERY, PING_EVERY);
        loop {
            tokio::select! {
                frame = rx.recv() => match frame {
                    Some(frame) => if sink.send(Message::Binary(frame)).await.is_err() { break },
                    None => break, // replaced or dropped by the relay
                },
                _ = ping.tick() => if sink.send(Message::Ping(Default::default())).await.is_err() { break },
            }
        }
        let _ = sink.close().await;
    };
    let reader = async {
        while let Ok(Some(Ok(message))) = tokio::time::timeout(SILENCE_LIMIT, stream.next()).await {
            match message {
                Message::Binary(frame) => relay.route(&member, &frame),
                Message::Close(_) => break,
                _ => {}
            }
        }
    };
    tokio::select! {
        _ = writer => {}
        _ = reader => {}
    }
    relay.leave(&member);
    tracing::debug!(room, ip = %relay::ip_text(address.0), port = address.1, "left");
}
