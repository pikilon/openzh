// Fake Emscripten module factory for tests/run-replay.spec.ts (issue #42).
//
// Prints one ZHWP_CRC line and then never reports an outcome, so the runner's
// timeout is the only way the run can end.
export default async function createFakeEngine(options) {
  options.print("ZHWP_CRC 9 deadbeef");
  await new Promise(() => {});
}
