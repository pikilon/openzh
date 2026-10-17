// Fake Emscripten module factory for tests/run-replay.spec.ts (issue #42).
//
// The runner owns the browser, so the test cannot read the page's variables.
// This module reports the engine arguments it received to the probe URL carried
// in its own query string, then exits with code 0.
const probe = new URL(import.meta.url).searchParams.get("probe");

export default async function createFakeEngine(options) {
  const args = Array.isArray(options.arguments) ? options.arguments : [];
  if (probe !== null) {
    const url = new URL("/args", probe);
    for (const arg of args) url.searchParams.append("arg", arg);
    await fetch(url, { mode: "cors" });
  }
  options.print("ZHWP_CRC 1 00000001");
  options.onExit(0);
}
