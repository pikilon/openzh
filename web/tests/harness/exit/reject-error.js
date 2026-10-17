// Fake Emscripten module factory for tests/smoke-exit.spec.ts.
//
// An ordinary failure is still an error, not an engine exit. It also records
// that the page provided the onExit option, as the factory contract requires.
export default async function createFakeEngine(options) {
  window.__fakeExitOption = typeof options.onExit;
  throw new Error("ordinary failure");
}
