// Fake engine module for tests/launcher-errors.spec.ts.
//
// Its factory resolves first and then aborts: the abort must replace the
// resolved outcome with the error outcome.
export default async function createFakeEngine(options) {
  window.__fakeEngineLoaded = "abort-late";
  setTimeout(() => options.onAbort("late boom"), 1000);
}
