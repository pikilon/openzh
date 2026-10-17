// Smoke page for the WASM engine build (docs/briefs/4-smoke-harness.md).
//
// Loads the Emscripten module factory and records everything it prints in
// window.__zhwpLog, plus the outcome in window.__zhwpDone. No external
// resources: the page only imports the module named by the `module` query
// parameter (default /engine/GeneralsXZH.js).

const params = new URLSearchParams(window.location.search);
const moduleUrl = params.get("module") ?? "/engine/GeneralsXZH.js";

window.__zhwpLog = [];
window.__zhwpDone = undefined;

function record(line) {
  window.__zhwpLog.push(line);
}

// Emscripten's exit() surfaces either through onExit or as an ExitStatus
// rejection: an object named "ExitStatus" whose status is the exit code.
function isExitStatus(reason) {
  return (
    reason !== null &&
    typeof reason === "object" &&
    reason.name === "ExitStatus" &&
    typeof reason.status === "number"
  );
}

function reportExit(code) {
  // Once the engine has exited, a later abort or resolution does not replace it.
  if (window.__zhwpDone?.status === "exited") return;
  window.__zhwpDone = { status: "exited", code: Number(code) };
}

function reportError(message) {
  // An abort after the factory resolved replaces the outcome, but an exit wins.
  if (window.__zhwpDone?.status === "exited") return;
  window.__zhwpDone = { status: "error", message: String(message ?? "unknown error") };
}

window.addEventListener("error", (event) => record("[page] " + event.message));
window.addEventListener("unhandledrejection", (event) => {
  record("[page] " + String(event.reason ?? "unhandled rejection"));
  if (isExitStatus(event.reason)) reportExit(event.reason.status);
});

try {
  const module = await import(moduleUrl);
  const createGeneralsX = module.default;
  if (typeof createGeneralsX !== "function") {
    throw new Error(`module ${moduleUrl} has no default-exported factory`);
  }
  const canvas = document.getElementById("canvas");
  // arg=-headless&arg=-replay&arg=a.rep selects the engine arguments, in URL
  // order and unchanged (docs/briefs/37-smoke-args.md). Without any arg the
  // page keeps opening a window.
  const engineArgs = params.getAll("arg");
  const options = {
    canvas,
    arguments: engineArgs.length > 0 ? engineArgs : ["-win"],
    print: record,
    printErr: record,
    onAbort: (reason) => reportError(reason),
    onExit: (code) => reportExit(code),
  };
  // archives=opfs mounts the archives stored in OPFS into the engine's file
  // system before it runs (docs/briefs/5b-mount-archives.md) and persists the
  // engine's user data across reloads (docs/briefs/19-persist-user-data.md).
  let factoryOptions = options;
  if (params.get("archives") === "opfs") {
    const engine = await import("/dist/engine.js");
    factoryOptions = await engine.prepareEngineOptions(options);
    factoryOptions.preRun.push((module) => {
      window.__zhwpModule = module;
    });
    window.__zhwpSaveUserData = () => engine.saveUserData(window.__zhwpModule);
  }
  await createGeneralsX(factoryOptions);
  if (window.__zhwpDone === undefined) window.__zhwpDone = { status: "resolved" };
} catch (error) {
  if (isExitStatus(error)) reportExit(error.status);
  else reportError(error instanceof Error ? error.message : String(error));
}
