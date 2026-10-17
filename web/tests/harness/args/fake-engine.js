// Fake Emscripten module factory for tests/smoke-args.spec.ts.
//
// It records the factory options the smoke page passed and resolves at once, so
// a test can inspect the engine arguments without starting the real engine.
// The preRun hooks are deliberately left untouched: these tests only care about
// the arguments the page builds.
export default async function createFakeEngine(options) {
  window.__fakeEngine = {
    arguments: options.arguments,
  };
}
