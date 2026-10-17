// Fake Emscripten module factory for tests/smoke-exit.spec.ts.
//
// The engine exits with code 0 and then the runtime reports an abort, as
// Emscripten does after exit(). The recorded exit must win.
export default async function createFakeEngine(options) {
  options.onExit(0);
  options.onAbort("x");
}
