#!/usr/bin/env bash
# Builds openzh-server on the VPS and restarts the `openzh` compose project.
# Needs the SSH alias `pikilon-vps` (root@69.62.106.16, key ~/.ssh/openzh_vps).
#
# Usage: server/deploy/deploy.sh
set -euo pipefail

server="$(cd "$(dirname "$0")/.." && pwd)"
host="${OPENZH_VPS:-pikilon-vps}"

COPYFILE_DISABLE=1 tar --no-xattrs -C "$server" -czf - Cargo.toml Cargo.lock Dockerfile src \
  | ssh "$host" 'rm -rf /opt/openzh-server && mkdir -p /opt/openzh-server && tar -C /opt/openzh-server -xzf -'
ssh "$host" 'docker build -q -t openzh-server:latest /opt/openzh-server && docker image prune -f >/dev/null'
scp -q "$server/deploy/compose.yml" "$host:/docker/openzh/docker-compose.yml"
ssh "$host" 'cd /docker/openzh && docker compose up -d --remove-orphans'

for _ in $(seq 1 30); do
  if curl -fsS https://server-openzh.pikilon.com/health >/dev/null 2>&1; then
    echo "deployed: https://server-openzh.pikilon.com/stats -> $(curl -fsS https://server-openzh.pikilon.com/stats)"
    exit 0
  fi
  sleep 2
done
echo "server-openzh.pikilon.com/health did not answer" >&2
exit 1
