//! OpenZH multiplayer server: the WebSocket relay that stands in for UDP,
//! and, for LAN parties, the game's own files.

pub mod relay;

use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use axum::Router;
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Query, State};
use axum::http::{HeaderName, HeaderValue, StatusCode, header};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use futures_util::{SinkExt, StreamExt};
use serde::Deserialize;
use tokio::sync::mpsc;
use tower_http::services::ServeDir;
use tower_http::set_header::SetResponseHeaderLayer;

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
}

/// The whole HTTP surface. `static_dir` serves the game for a LAN party.
pub fn app(relay: Arc<Relay>, static_dir: Option<PathBuf>) -> Router {
    let router = Router::new()
        .route(RELAY_PATH, get(upgrade))
        .route("/health", get(|| async { "ok" }))
        .route("/stats", get(|State(relay): State<Arc<Relay>>| async move { axum::Json(relay.stats()) }))
        .with_state(relay);
    let router = match static_dir {
        Some(dir) => router.fallback_service(ServeDir::new(dir).append_index_html_on_directories(true)),
        None => router,
    };
    // The engine needs cross-origin isolation (threads, SharedArrayBuffer); same headers as web/scripts/serve.mjs.
    router
        .layer(header_layer("cross-origin-opener-policy", "same-origin"))
        .layer(header_layer("cross-origin-embedder-policy", "require-corp"))
        .layer(header_layer("cross-origin-resource-policy", "cross-origin"))
        .layer(SetResponseHeaderLayer::overriding(header::CACHE_CONTROL, HeaderValue::from_static("no-cache")))
}

fn header_layer(name: &'static str, value: &'static str) -> SetResponseHeaderLayer<HeaderValue> {
    SetResponseHeaderLayer::overriding(HeaderName::from_static(name), HeaderValue::from_static(value))
}

async fn upgrade(ws: WebSocketUpgrade, Query(query): Query<RelayQuery>, State(relay): State<Arc<Relay>>) -> Response {
    let Some(room) = relay::room_name(query.room.as_deref()) else {
        return (StatusCode::BAD_REQUEST, "room: up to 32 letters, digits, - or _").into_response();
    };
    ws.max_message_size(HEADER_LEN + MAX_PAYLOAD)
        .on_upgrade(move |socket| connection(socket, relay, room))
}

async fn connection(socket: WebSocket, relay: Arc<Relay>, room: String) {
    let (mut sink, mut stream) = socket.split();

    let first = tokio::time::timeout(REGISTRATION_TIMEOUT, stream.next()).await;
    let Ok(Some(Ok(Message::Binary(first)))) = first else { return };
    let Some(address) = relay::parse_registration(&first) else { return };

    let (tx, mut rx) = mpsc::channel(relay.limits.queue);
    let member = match relay.join(&room, address, tx) {
        Ok(member) => member,
        Err(error) => {
            tracing::warn!(room, ?error, "join refused");
            let _ = sink.close().await;
            return;
        }
    };
    tracing::debug!(room, ip = %relay::ip_text(address.0), port = address.1, "joined");

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
