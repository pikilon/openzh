// A bridge worker that says it is ready and then never answers a request:
// stands in for a worker that died or stalled (tests/bridge-watchdog.spec.ts).
addEventListener("message", () => postMessage({ ready: true }));
