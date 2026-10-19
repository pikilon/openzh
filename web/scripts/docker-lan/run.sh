#!/bin/sh
# Two Chromium containers on a network with no internet connect to each other
# through the launcher's LAN flow (host code, guest code, WebRTC data channel).
# Needs Docker and `npm run build`. Usage: scripts/docker-lan/run.sh
set -e
cd "$(dirname "$0")/../.."
IMG=mcr.microsoft.com/playwright:v1.64.1-noble
docker rm -f zh-web zh-a zh-b >/dev/null 2>&1 || true
docker network rm zhlan >/dev/null 2>&1 || true
docker network create --internal zhlan >/dev/null
docker run -d --name zh-web --network zhlan --network-alias web -v "$PWD":/w:ro -w /w $IMG \
  sh -c "sed 's/127.0.0.1/0.0.0.0/' scripts/serve.mjs > /tmp/s.mjs && node /tmp/s.mjs --port 4391 --mount /app=app --mount /dist=dist --mount /=app" >/dev/null
for n in a b; do
  port=$([ $n = a ] && echo 3001 || echo 3002)
  docker create --name zh-$n --ipc=host -p $port:3000 $IMG sh -c "npx -y playwright@1.64.1 run-server --port 3000 --host 0.0.0.0" >/dev/null
  docker network connect zhlan zh-$n --alias $n
  docker start zh-$n >/dev/null
done
sleep 20
# The page must be a secure context, so each machine reaches the web server as localhost.
for n in a b; do
  docker exec -d zh-$n node -e 'const n=require("net");n.createServer(c=>{const s=n.connect(4391,"web");c.pipe(s).pipe(c);c.on("error",()=>{});s.on("error",()=>{})}).listen(4391,"127.0.0.1")'
done
node scripts/docker-lan/lan.mjs
docker rm -f zh-web zh-a zh-b >/dev/null; docker network rm zhlan >/dev/null
