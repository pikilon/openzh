// Worker half of FileBridge: opens the stored archives with
// createSyncAccessHandle() and serves synchronous reads over a shared block
// (docs/decisions.md, D-03). The worker blocks on Atomics.wait; the main
// thread spins on Atomics.load.

import type { GameKind } from "./install";

interface StartMessage {
  files: { kind: GameKind; name: string }[];
  control: SharedArrayBuffer;
  data: SharedArrayBuffer;
}

// Indices into the Int32Array control area.
const REQ = 0; // request flag: 0 idle, 1 read request
const STATUS = 1; // 0 working, 1 ok, 2 error
const INDEX = 2; // index into the file list, -1 for none
const LENGTH = 3; // bytes read into the data area, or 0
const ERROR = 4; // 1 when the request failed
const CLOSE = 5; // request flag: 1 close request
const CONTROL_LEN = 6;

const BLOCK = 4 * 1024 * 1024;

type AccessHandle = {
  read(buffer: ArrayBuffer | ArrayBufferView, options?: { at?: number }): number;
  close(): void;
};

const handles: AccessHandle[] = [];

// A page that is going away (a reload, a Retry) may still be releasing the
// same files, so a lock conflict is retried for a short while before failing.
const OPEN_RETRY_MS = 150;
const OPEN_RETRY_LIMIT_MS = 3000;

function isLockConflict(error: unknown): boolean {
  const name = (error as { name?: string } | null)?.name;
  return name === "NoModificationAllowedError" || name === "InvalidStateError";
}

async function openFile(kind: GameKind, name: string): Promise<AccessHandle> {
  const root = await navigator.storage.getDirectory();
  const parent = await root.getDirectoryHandle("zhwp").then((d) => d.getDirectoryHandle(kind));
  const file = await parent.getFileHandle(name);
  const create = (file as FileSystemFileHandle & {
    createSyncAccessHandle(): Promise<AccessHandle>;
  }).createSyncAccessHandle;
  const deadline = performance.now() + OPEN_RETRY_LIMIT_MS;
  for (;;) {
    try {
      return await create.call(file);
    } catch (error) {
      if (!isLockConflict(error) || performance.now() >= deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, OPEN_RETRY_MS));
    }
  }
}

async function main(): Promise<void> {
  addEventListener("message", async (event: MessageEvent<StartMessage>) => {
    const { files, control, data } = event.data;
    const ctl = new Int32Array(control);
    const dataBytes = new Uint8Array(data);
    // The position is read through a Float64Array over the same control block.
    const position = new Float64Array(control, CONTROL_LEN * 4, 1);

    for (const file of files) {
      try {
        handles.push(await openFile(file.kind, file.name));
      } catch (error) {
        // The start fails as a whole: release what was opened so a Retry (or
        // another tab) can open the same files, and serve nothing.
        for (const handle of handles) handle?.close();
        handles.length = 0;
        postMessage({ error: String(error) });
        return;
      }
    }
    postMessage({ ready: true });

    for (;;) {
      Atomics.wait(ctl, REQ, 0);
      if (Atomics.load(ctl, CLOSE) === 1) {
        for (const handle of handles) handle?.close();
        Atomics.store(ctl, STATUS, 1);
        Atomics.store(ctl, CLOSE, 0);
        Atomics.notify(ctl, CLOSE);
        break;
      }
      const index = Atomics.load(ctl, INDEX);
      const length = Atomics.load(ctl, LENGTH);
      const handle = handles[index];
      if (handle === undefined) {
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
