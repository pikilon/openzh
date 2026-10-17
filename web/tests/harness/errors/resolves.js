// Fake engine module for tests/launcher-errors.spec.ts.
//
// Its factory resolves at once, so the launcher must report the resolved
// outcome and keep the error alert hidden.
export default async function createFakeEngine() {
  window.__fakeEngineLoaded = "resolves";
}
