// Fake Emscripten module factory for tests/smoke-exit.spec.ts.
//
// The engine exits with code 0 and the factory resolves afterwards. The
// recorded exit must win over the resolved outcome.
export default async function createFakeEngine(options) {
  options.onExit(0);
  await new Promise((resolve) => setTimeout(resolve, 100));
}
