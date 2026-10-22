// Picks where the engine runs fixed-function transform and lighting before it
// starts; WebGPUD3DDevice::updateFixedFunctionChoice reads globalThis.zhwpCpuTnl.
// ?cputnl=1 forces the CPU and ?cputnl=0 the GPU. Without the parameter Android
// gets the CPU: there the GPU path turns the canvas white, Brave's GPU process
// dies 10-100 s in, in about half the loads (Nubia NX733J, Adreno, 2026-10-22,
// 0 of 6 on the CPU); the cause is still open. Other systems keep the GPU.

export function chooseTransformLighting(): void {
  const page = globalThis as typeof globalThis & { zhwpCpuTnl?: boolean };
  if (page.zhwpCpuTnl !== undefined) return;
  const choice = new URLSearchParams(location.search).get("cputnl");
  page.zhwpCpuTnl = choice === null ? /Android/i.test(navigator.userAgent) : choice === "1";
}
