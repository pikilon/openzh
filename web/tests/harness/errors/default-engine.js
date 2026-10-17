// Fake engine module served in place of the default engine by
// tests/launcher-errors.spec.ts. It records that the launcher loaded the
// default module URL, then resolves.
export default async function createFakeEngine() {
  window.__defaultEngineLoaded = true;
}
