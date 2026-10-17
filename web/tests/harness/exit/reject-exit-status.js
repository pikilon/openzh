// Fake Emscripten module factory for tests/smoke-exit.spec.ts.
//
// Emscripten's exit() can also surface as an ExitStatus rejection: an object
// whose name is "ExitStatus" and whose status is the exit code.
export default async function createFakeEngine() {
  throw { name: "ExitStatus", status: 1 };
}
