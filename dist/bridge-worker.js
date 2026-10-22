// src/bridge-worker.ts
var REQ = 0;
var STATUS = 1;
var INDEX = 2;
var LENGTH = 3;
var ERROR = 4;
var CLOSE = 5;
var CONTROL_LEN = 6;
var BLOCK = 4 * 1024 * 1024;
var handles = [];
var OPEN_RETRY_MS = 150;
var OPEN_RETRY_LIMIT_MS = 3e3;
function isLockConflict(error) {
  const name = error?.name;
  return name === "NoModificationAllowedError" || name === "InvalidStateError";
}
async function openFile(kind, name) {
  const root = await navigator.storage.getDirectory();
  const parent = await root.getDirectoryHandle("zhwp").then((d) => d.getDirectoryHandle(kind));
  const file = await parent.getFileHandle(name);
  const create = file.createSyncAccessHandle;
  const deadline = performance.now() + OPEN_RETRY_LIMIT_MS;
  for (; ; ) {
    try {
      return await create.call(file);
    } catch (error) {
      if (!isLockConflict(error) || performance.now() >= deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, OPEN_RETRY_MS));
    }
  }
}
async function main() {
  addEventListener("message", async (event) => {
    const { files, control, data } = event.data;
    const ctl = new Int32Array(control);
    const dataBytes = new Uint8Array(data);
    const position = new Float64Array(control, CONTROL_LEN * 4, 1);
    for (const file of files) {
      try {
        handles.push(await openFile(file.kind, file.name));
      } catch (error) {
        for (const handle of handles) handle?.close();
        handles.length = 0;
        postMessage({ error: String(error) });
        return;
      }
    }
    postMessage({ ready: true });
    for (; ; ) {
      Atomics.wait(ctl, REQ, 0);
      if (Atomics.load(ctl, CLOSE) === 1) {
        for (const handle2 of handles) handle2?.close();
        Atomics.store(ctl, STATUS, 1);
        Atomics.store(ctl, CLOSE, 0);
        Atomics.notify(ctl, CLOSE);
        break;
      }
      const index = Atomics.load(ctl, INDEX);
      const length = Atomics.load(ctl, LENGTH);
      const handle = handles[index];
      if (handle === void 0) {
        Atomics.store(ctl, ERROR, 1);
        Atomics.store(ctl, LENGTH, 0);
      } else {
        Atomics.store(ctl, ERROR, 0);
        try {
          const chunk = dataBytes.subarray(0, Math.min(length, BLOCK));
          const read = handle.read(chunk, { at: position[0] });
          Atomics.store(ctl, LENGTH, Math.max(0, read));
        } catch {
          Atomics.store(ctl, ERROR, 1);
          Atomics.store(ctl, LENGTH, 0);
        }
      }
      Atomics.store(ctl, REQ, 0);
      Atomics.store(ctl, STATUS, 1);
      Atomics.notify(ctl, REQ);
    }
    close();
  });
}
void main();
