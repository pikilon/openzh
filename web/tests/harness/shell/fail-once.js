// Fake engine module for tests/launcher-shell.spec.ts (issue #159).
//
// The first factory call rejects; the second one, the call #retry makes,
// resolves. window.__factoryCalls records how many times the page invoked the
// factory, so a test can see the retry really started the engine again.
export default async function createFakeEngine() {
  window.__factoryCalls = (window.__factoryCalls ?? 0) + 1;
  window.__fakeEngineLoaded = "shell-fail-once";
  if (window.__factoryCalls === 1) throw new Error("first attempt failed");
}
