// Fake engine module for tests/launcher-shell.spec.ts (issue #159).
//
// Its factory resolves at once and counts its calls in window.__factoryCalls,
// so a test can tell the automatic start from a second, duplicate one. The
// launcher selects it with the `module` query parameter.
export default async function createFakeEngine() {
  window.__factoryCalls = (window.__factoryCalls ?? 0) + 1;
  window.__fakeEngineLoaded = "shell-counts";
}
