// Fake Emscripten module factory for tests/smoke-exit.spec.ts.
//
// The engine exits with code 1 (a CRC mismatch) by calling the factory's
// onExit option. The factory then resolves, as a real one does after exit().
export default async function createFakeEngine(options) {
  options.onExit(1);
}
