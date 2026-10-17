// Entry point the browser tests load (tests/harness/index.html). It only
// re-exports the wrapper's modules so tests exercise the real code.
export { classifyArchives, REQUIRED } from "./install";
export { storeFiles, listStored, clearStored } from "./opfs-store";
export { formatBytes, bytesNeeded, available } from "./storage";
export { FileBridge } from "./bridge";
