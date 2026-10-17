// Fake Emscripten module factory for tests/smoke-exit.spec.ts.
//
// A rejected promise nobody handles surfaces as an unhandledrejection on the
// page. Emscripten's exit() is reported that way too, so the page must treat
// an ExitStatus rejection as an exit.
export default async function createFakeEngine() {
  Promise.reject({ name: "ExitStatus", status: 1 });
  await new Promise((resolve) => setTimeout(resolve, 100));
}
