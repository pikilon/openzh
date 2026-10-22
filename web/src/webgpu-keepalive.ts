// The engine asks for its WebGPU adapter and device through emdawnwebgpu and
// then drops its own handles (wgpuAdapterRelease, wgpuInstanceRelease). Nothing
// else in the page references them, so Chromium's garbage collector may free
// the GPUAdapter while the game is running; the device is then lost with
// "A valid external Instance reference no longer exists." and the canvas goes
// white, 12 to 30 s after the engine starts (phone, Brave 155, 2026-10-21; a
// bare WebGPU page that kept its adapter in a variable ran 100 s without loss).
// Holding both objects for the life of the page was meant to prevent it, but
// the phone still went white with it on 2026-10-22 (see transform-lighting.ts).

type Gpu = {
  requestAdapter: (...args: unknown[]) => Promise<any>;
  __zhwpKeepAlive?: true;
};

// Strong references; nothing ever removes them (the page lives as long as the engine).
const kept: unknown[] = [];

export function keepWebGpuAlive(): void {
  const gpu = (typeof navigator === "undefined" ? undefined : navigator.gpu) as unknown as Gpu | undefined;
  if (gpu === undefined || gpu.__zhwpKeepAlive === true) return;
  const requestAdapter = gpu.requestAdapter.bind(gpu);
  gpu.requestAdapter = async (...args: unknown[]) => {
    const adapter = await requestAdapter(...args);
    if (adapter === null || adapter === undefined) return adapter;
    kept.push(adapter);
    const requestDevice = adapter.requestDevice.bind(adapter);
    adapter.requestDevice = async (...deviceArgs: unknown[]) => {
      const device = await requestDevice(...deviceArgs);
      kept.push(device);
      return device;
    };
    return adapter;
  };
  gpu.__zhwpKeepAlive = true;
  // Read by tests/webgpu-keepalive.spec.ts.
  (window as unknown as { __zhwpWebGpuRefs?: unknown[] }).__zhwpWebGpuRefs = kept;
}
