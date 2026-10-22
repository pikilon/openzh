// Picks where the engine runs fixed-function transform and lighting before it
// starts; WebGPUD3DDevice::updateFixedFunctionChoice reads globalThis.zhwpCpuTnl.
// ?cputnl=1 forces the CPU and ?cputnl=0 the GPU; without the parameter every
// system uses the GPU. Android briefly defaulted to the CPU (2026-10-22): the
// white canvas it avoided came from retired mirror buffers piling up in GPU
// memory, which WebGPUD3DDevice now reuses.

export function chooseTransformLighting(): void {
  const page = globalThis as typeof globalThis & { zhwpCpuTnl?: boolean };
  if (page.zhwpCpuTnl !== undefined) return;
  page.zhwpCpuTnl = new URLSearchParams(location.search).get("cputnl") === "1";
}
