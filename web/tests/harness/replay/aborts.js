// Fake Emscripten module factory for tests/run-replay.spec.ts (issue #42).
//
// Aborts while starting, so the smoke page reports an error and the runner
// must end with RESULT error.
export default async function createFakeEngine(options) {
  options.print("[fake] aborting");
  options.onAbort("fake abort");
}
