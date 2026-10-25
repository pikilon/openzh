// Fake engine module for tests/launcher-keyboard.spec.ts (issue #202): the
// page must keep playing when the build predates `_GeneralsXSetKeyMap`.
export default async function createFakeEngine() {
  window.__fakeEngineLoaded = "keyboard-no-export";
  return {};
}
