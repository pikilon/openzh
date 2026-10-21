// Fake engine module for tests/webgpu-keepalive.spec.ts.
//
// Like emdawnwebgpu it asks for an adapter and a device and keeps no reference
// of its own, so only the launcher's keep-alive can hold them.
export default async function createFakeEngine() {
  const adapter = await navigator.gpu.requestAdapter();
  const device = await adapter.requestDevice();
  window.__fakeEngineHandles = { adapter: adapter === null, device: device === null };
}
