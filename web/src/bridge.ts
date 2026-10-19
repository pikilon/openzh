// Main-thread half of FileBridge: synchronous reads of the stored archives
// through a worker that holds the FileSystemSyncAccessHandles
// (docs/decisions.md, D-03). Atomics.wait is not allowed on the main thread,
// so this side spins on Atomics.load until the worker marks a request done.

import type { GameKind } from "./install";
import type { StoredFile } from "./opfs-store";

// Indices into the Int32Array control area (shared with bridge-worker.ts).
const REQ = 0;
const STATUS = 1;
const INDEX = 2;
const LENGTH = 3;
const ERROR = 4;
const CLOSE = 5;
const CONTROL_LEN = 6;

const BLOCK = 4 * 1024 * 1024;

type WorkerMessage = { ready?: boolean; error?: string };

interface SharedBridgeState {
  control: Int32Array;
  position: Float64Array;
  data: Uint8Array;
}

export class FileBridge {
  static readonly DEFAULT_READ_TIMEOUT_MS = 10_000;

  private dead = false;
  private closeStarted = false;

  private constructor(
    private readonly worker: Worker,
    private readonly shared: SharedBridgeState,
    private readonly files: readonly StoredFile[],
    private readonly readTimeoutMs: number,
  ) {}

  static async start(
    files: StoredFile[],
    workerUrl?: string | URL,
    options?: { readTimeoutMs?: number },
  ): Promise<FileBridge> {
    const timeout = options?.readTimeoutMs;
    const readTimeoutMs = timeout === undefined ? FileBridge.DEFAULT_READ_TIMEOUT_MS : timeout;
    const url = workerUrl ?? new URL("./bridge-worker.js", import.meta.url);
    const worker = new Worker(url, { type: "module" });
    // One request block: control (Int32 + a Float64 position) plus data.
    const controlBuffer = new SharedArrayBuffer(CONTROL_LEN * 4 + 8);
    const dataBuffer = new SharedArrayBuffer(BLOCK);
    const shared: SharedBridgeState = {
      control: new Int32Array(controlBuffer),
      position: new Float64Array(controlBuffer, CONTROL_LEN * 4, 1),
      data: new Uint8Array(dataBuffer),
    };
    let failure = "";
    const ready = new Promise<void>((resolve, reject) => {
      worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
        if (event.data.ready) resolve();
        else if (event.data.error) reject(new Error(event.data.error));
      };
      worker.onerror = (event) => {
        failure = String(event.message ?? event.error ?? "worker error");
        reject(new Error(failure));
      };
    });
    worker.postMessage(
      {
        files: files.map((file) => ({ kind: file.kind, name: file.name })),
        control: controlBuffer,
        data: dataBuffer,
      },
      [],
    );
    try {
      await ready;
    } catch (error) {
      // The worker has released its handles; it must not linger either.
      worker.terminate();
      throw error;
    }
    return new FileBridge(worker, shared, files, readTimeoutMs);
  }

  size(kind: GameKind, name: string): number {
    const index = this.index(kind, name);
    return this.files[index].size;
  }

  readSync(kind: GameKind, name: string, position: number, target: Uint8Array): number {
    if (this.dead || this.closeStarted) throw new Error(`bridge closed: cannot read ${kind}/${name}`);
    const index = this.index(kind, name);
    const file = this.files[index];
    if (!Number.isFinite(position) || position < 0) throw new Error(`bad read position: ${position}`);
    if (position >= file.size) return 0;
    const wanted = Math.min(target.length, file.size - position);
    let readTotal = 0;
    while (readTotal < wanted) {
      const chunk = Math.min(BLOCK, wanted - readTotal);
      let read: number;
      try {
        read = this.request(index, position + readTotal, chunk);
      } catch (error) {
        // A stalled worker makes the bridge unusable from here on.
        this.giveUp();
        throw error;
      }
      if (read <= 0) break;
      target.set(this.shared.data.subarray(0, Math.min(read, chunk)), readTotal);
      readTotal += read;
      if (read < chunk) break;
    }
    return readTotal;
  }

  async close(): Promise<void> {
    if (this.dead || this.closeStarted) return;
    this.closeStarted = true;
    const { control } = this.shared;
    Atomics.store(control, CLOSE, 1);
    Atomics.store(control, REQ, 1);
    Atomics.notify(control, REQ);
    // A worker that never answers still must not leave the caller waiting.
    if (this.spin(() => Atomics.load(control, CLOSE) === 0)) {
      this.dead = true;
      this.worker.terminate();
    } else {
      this.giveUp();
    }
  }

  private index(kind: GameKind, name: string): number {
    const index = this.files.findIndex((file) => file.kind === kind && file.name === name);
    if (index < 0) throw new Error(`unknown file: ${kind}/${name}`);
    return index;
  }

  private request(index: number, position: number, length: number): number {
    const { control, data, position: positionView } = this.shared;
    positionView[0] = position;
    Atomics.store(control, INDEX, index);
    Atomics.store(control, LENGTH, length);
    Atomics.store(control, STATUS, 0);
    Atomics.store(control, REQ, 1);
    Atomics.notify(control, REQ);
    // Atomics.wait is forbidden here, so spin until the worker is done.
    const file = this.files[index];
    if (!this.spin(() => Atomics.load(control, STATUS) === 1)) {
      throw new Error(`read timed out: ${file.kind}/${file.name} at ${position}`);
    }
    const read = Atomics.load(control, LENGTH);
    if (Atomics.load(control, ERROR) === 1) {
      throw new Error(`read failed: ${file.kind}/${file.name} at ${position}`);
    }
    return read;
  }

  // Marks the bridge unusable and kills the worker: the caller keeps running.
  private giveUp(): void {
    this.dead = true;
    this.worker.terminate();
  }

  // Busy-wait: the worker answers in microseconds and cannot wake us. The
  // time limit is checked every 1024 iterations so a stalled worker cannot
  // block the main thread forever. Returns false on time-out.
  private spin(done: () => boolean): boolean {
    let iterations = 0;
    const deadline = performance.now() + this.readTimeoutMs;
    while (!done()) {
      if ((++iterations & 1023) === 0 && performance.now() >= deadline) return false;
    }
    return true;
  }
}
