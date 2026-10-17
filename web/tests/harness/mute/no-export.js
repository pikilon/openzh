// Fake engine module for tests/launcher-mute.spec.ts (issue #99).
//
// Its factory resolves to an engine object without
// `_GeneralsXSetAudioMuted`, the shape of a build that has no such export. The
// page must ignore it: no error, no rejected promise, the game keeps playing.
export default async function createFakeEngine() {
  window.__fakeEngineLoaded = "mute-no-export";
  return {};
}
