// Fake Emscripten module factory for tests/run-replay.spec.ts (issue #42).
//
// Prints two ZHWP_CRC lines and then exits with code 1, so the lines printed
// before the failure must still reach the out file.
export default async function createFakeEngine(options) {
  options.print("ZHWP_CRC 1 11111111");
  options.print("ZHWP_CRC 2 22222222");
  options.onExit(1);
}
