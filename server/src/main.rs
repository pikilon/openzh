//! `openzh-server`: the online relay. It runs on the VPS behind Traefik, which
//! terminates TLS (server-openzh.pikilon.com), and answers STUN on UDP 3478 so
//! players can link directly. Games without internet need no server: the
//! host's tab is the relay (web/src/lan.ts).

use std::net::SocketAddr;
use std::sync::Arc;

use clap::Parser;
use openzh_server::relay::{Limits, Relay};
use openzh_server::{RELAY_PATH, app};

#[derive(Parser)]
#[command(version, about)]
struct Args {
    /// Plain HTTP listener; a reverse proxy in front terminates TLS.
    #[arg(long, default_value = "0.0.0.0:8080")]
    http: SocketAddr,
    /// STUN binding responder for direct WebRTC links between players (UDP); `none` turns it off.
    #[arg(long, default_value = "0.0.0.0:3478")]
    stun: String,
    #[arg(long, default_value_t = Limits::default().max_rooms)]
    max_rooms: usize,
    #[arg(long, default_value_t = Limits::default().max_sockets_per_room)]
    max_sockets_per_room: usize,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()))
        .init();
    let args = Args::parse();
    let limits = Limits { max_rooms: args.max_rooms, max_sockets_per_room: args.max_sockets_per_room, ..Limits::default() };
    let listener = tokio::net::TcpListener::bind(args.http).await?;
    tracing::info!("relay ws://{}{RELAY_PATH}", args.http);
    if args.stun != "none" {
        let stun = tokio::net::UdpSocket::bind(&args.stun).await?;
        tracing::info!("stun udp://{}", args.stun);
        tokio::spawn(async move {
            if let Err(error) = openzh_server::stun::serve(stun).await {
                tracing::error!(%error, "stun stopped");
            }
        });
    }
    axum::serve(listener, app(Arc::new(Relay::new(limits)))).await?;
    Ok(())
}
