// Fake engine module for tests/launcher-errors.spec.ts.
//
// Its factory rejects, so the launcher must report the rejection message.
export default async function createFakeEngine() {
  window.__fakeEngineLoaded = "rejects";
  throw new Error("nope");
}
