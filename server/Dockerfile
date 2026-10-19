# Static openzh-server for the online relay (server-openzh.pikilon.com).
FROM rust:1-alpine AS build
RUN apk add --no-cache musl-dev
WORKDIR /src
COPY Cargo.toml Cargo.lock ./
COPY src src
RUN cargo build --release --locked

FROM scratch
COPY --from=build /src/target/release/openzh-server /openzh-server
USER 65534
EXPOSE 8080 3478/udp
ENTRYPOINT ["/openzh-server", "--http", "0.0.0.0:8080"]
