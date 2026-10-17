// Fake engine module for tests/launcher-errors.spec.ts.
//
// Its factory fires the Emscripten abort callback while starting, so the
// launcher must report an error even though the factory itself resolves.
export default async function createFakeEngine(options) {
  window.__fakeEngineLoaded = "abort";
  options.onAbort("boom");
}
