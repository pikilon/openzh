// Fake engine module for tests/launcher-mute.spec.ts (issue #99).
//
// Its factory resolves to an engine object whose `_GeneralsXSetAudioMuted`
// records every value the page sends in window.__muteCalls, so a test can read
// what the page told the engine. It returns 1, like the Emscripten export.
export default async function createFakeEngine() {
  window.__muteCalls = [];
  return {
    _GeneralsXSetAudioMuted(muted) {
      window.__muteCalls.push(muted);
      return 1;
    },
  };
}
