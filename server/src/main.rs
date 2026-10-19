//! `openzh-server`: run it on a PC for a LAN party (serves the game and the
//! relay, works without internet), or on a server behind a TLS proxy for
//! online play (`--no-tls`).

use std::net::{IpAddr, SocketAddr, UdpSocket};
use std::path::PathBuf;
use std::sync::Arc;

use anyhow::Context;
use axum_server::tls_rustls::RustlsConfig;
use clap::Parser;
use openzh_server::relay::{Limits, Relay};
use openzh_server::{RELAY_PATH, app};

#[derive(Parser)]
#[command(version, about)]
struct Args {
    /// Folder with the packaged game (web/out) to serve to the LAN.
    #[arg(long = "static", value_name = "DIR")]
    static_dir: Option<PathBuf>,
    /// Plain HTTP listener. Browsers only treat http://localhost as secure,
    /// so other PCs of the LAN must use the HTTPS one.
    #[arg(long, default_value = "0.0.0.0:8766")]
    http: SocketAddr,
    /// HTTPS listener with a self-signed certificate made at start-up; the
    /// engine looks for the relay on port 8765.
    #[arg(long, default_value = "0.0.0.0:8765")]
    https: SocketAddr,
    /// No HTTPS listener: a reverse proxy in front terminates TLS.
    #[arg(long)]
    no_tls: bool,
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
    if let Some(dir) = &args.static_dir {
        anyhow::ensure!(dir.join("index.html").is_file(), "{} has no index.html", dir.display());
    }

    let limits = Limits { max_rooms: args.max_rooms, max_sockets_per_room: args.max_sockets_per_room, ..Limits::default() };
    // One relay for both listeners, or players on each would never see each other.
    let relay = Arc::new(Relay::new(limits));
    let router = app(relay, args.static_dir.clone());
    let lan_ip = lan_ip();

    let http = axum_server::bind(args.http).serve(router.clone().into_make_service());
    tracing::info!("relay ws://{}{RELAY_PATH}", args.http);

    if args.no_tls {
        http.await?;
        return Ok(());
    }

    rustls::crypto::ring::default_provider().install_default().ok();
    let mut names = vec!["localhost".to_owned(), "127.0.0.1".to_owned()];
    names.extend(lan_ip.map(|ip| ip.to_string()));
    let cert = rcgen::generate_simple_self_signed(names).context("self-signed certificate")?;
    let tls = RustlsConfig::from_pem(cert.cert.pem().into_bytes(), cert.key_pair.serialize_pem().into_bytes()).await?;
    let https = axum_server::bind_rustls(args.https, tls).serve(router.into_make_service());

    if args.static_dir.is_some() {
        let host = lan_ip.map_or("<IP de este PC>".to_owned(), |ip| ip.to_string());
        println!();
        println!("  OpenZH LAN listo.");
        println!("  En este PC:      http://localhost:{}", args.http.port());
        println!("  En los demás PC: https://{host}:{}", args.https.port());
        println!("  (el certificado es propio: la primera vez el navegador avisa; pulsa Avanzado → Continuar)");
        println!();
    }

    tokio::try_join!(http, https)?;
    Ok(())
}

/// The address other PCs reach this one at. Opening a UDP socket "towards"
/// a public address sends nothing, it only picks the outgoing interface;
/// without any route (fully offline LAN with no gateway) it fails and the
/// user reads the address from the system.
fn lan_ip() -> Option<IpAddr> {
    let socket = UdpSocket::bind("0.0.0.0:0").ok()?;
    socket.connect("192.0.2.1:9").ok()?;
    socket.local_addr().ok().map(|a| a.ip()).filter(|ip| !ip.is_loopback() && !ip.is_unspecified())
}
