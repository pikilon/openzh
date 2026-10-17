// Fake Emscripten module factory for tests/run-replay.spec.ts (issue #42).
//
// Prints three ZHWP_CRC lines among other output, including lines that contain
// the prefix but do not start with it, and exits with code 0. The runner must
// copy exactly the three prefixed lines, in order.
export default async function createFakeEngine(options) {
  options.print("[fake] replay started");
  options.print("ZHWP_CRC 1 0a1b2c3d");
  options.printErr("[fake] engine noise on stderr");
  options.print("ZHWP_CRCX 99 deadbeef");
  options.print("  ZHWP_CRC 98 deadbeef");
  options.print("ZHWP_CRC 2 0a1b2c3e");
  options.print("[fake] frame between CRC lines");
  options.print("ZHWP_CRC 3 0a1b2c3f");
  options.print("[fake] replay finished");
  options.onExit(0);
}
