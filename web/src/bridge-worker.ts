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

async function openFile(kind: GameKind, name: string): Promise<AccessHandle> {
  const root = await navigator.storage.getDirectory();
  const parent = await root.getDirectoryHandle("zhwp").then((d) => d.getDirectoryHandle(kind));
  const file = await parent.getFileHandle(name);
  const create = (file as FileSystemFileHandle & {
    createSyncAccessHandle(): Promise<AccessHandle>;
  }).createSyncAccessHandle;
  return create.call(file);
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
        // A file that cannot be opened leaves no handle: requests for its
        // index are answered with an error.
        handles.push(undefined as unknown as AccessHandle);
        postMessage({ error: String(error) });
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
