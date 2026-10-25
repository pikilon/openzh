// src/install.ts
var REQUIRED = {
  zh: ["INIZH.big", "W3DZH.big"],
  generals: ["INI.big", "W3D.big"]
};
var KIND_ORDER = { zh: 0, generals: 1 };
function requiredKeys(kind) {
  return REQUIRED[kind].map((name) => name.toLowerCase());
}
function classifyArchives(paths) {
  const archives = [];
  const seen = /* @__PURE__ */ new Set();
  for (const path of paths) {
    const name = path.slice(path.lastIndexOf("/") + 1);
    const lower = name.toLowerCase();
    if (!lower.endsWith(".big") || lower === ".big") continue;
    const kind = lower.endsWith("zh.big") ? "zh" : "generals";
    const key = `${kind}\0${lower}`;
    if (seen.has(key)) continue;
    seen.add(key);
    archives.push({ kind, name, path });
  }
  archives.sort(
    (a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.name.toLowerCase().localeCompare(b.name.toLowerCase())
  );
  const missing = [];
  const byName = new Set(archives.map((entry) => entry.name.toLowerCase()));
  for (const kind of ["zh", "generals"]) {
    for (let i = 0; i < REQUIRED[kind].length; i++) {
      if (!byName.has(requiredKeys(kind)[i])) missing.push(REQUIRED[kind][i]);
    }
  }
  return { archives, missing };
}

// src/storage.ts
function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}
function bytesNeeded(picked, stored) {
  const have = new Set(
    stored.map((entry) => `${entry.kind}\0${entry.name.toLowerCase()}\0${entry.size}`)
  );
  let needed = 0;
  for (const entry of picked) {
    const key = `${entry.kind}\0${entry.name.toLowerCase()}\0${entry.size}`;
    if (!have.has(key)) needed += entry.size;
  }
  return needed;
}
function available(estimate) {
  if (estimate.quota === void 0) return void 0;
  return estimate.quota - (estimate.usage ?? 0);
}

// src/import-error.ts
var ImportError = class extends Error {
  code;
  detail;
  constructor(code, detail, cause) {
    super(code, cause === void 0 ? void 0 : { cause });
    this.name = "ImportError";
    this.code = code;
    this.detail = detail ?? {};
  }
};
var RECOVERABLE = /* @__PURE__ */ new Set([
  "quota-exceeded",
  "storage-unavailable",
  "read-failed",
  "aborted",
  "unknown"
]);
function isRecoverable(code) {
  return RECOVERABLE.has(code);
}
function quoted(file) {
  return `"${file}"`;
}
function describe(code, detail) {
  const file = detail.file;
  const suffix = file === void 0 ? "" : ` (file: ${quoted(file)})`;
  switch (code) {
    case "not-a-zip":
      return {
        code,
        message: `The selected file${suffix} is not a valid ZIP archive.`,
        hint: "Choose the ZIP file downloaded from your game installation."
      };
    case "truncated":
      return {
        code,
        message: `The ZIP archive${suffix} is truncated and cannot be read to the end.`,
        hint: "Download or copy the ZIP again, then retry the import."
      };
    case "multi-disk":
      return {
        code,
        message: `The ZIP archive${suffix} is part of a multi-disk set, which is not supported.`,
        hint: "Combine the parts into a single ZIP, or use a complete archive."
      };
    case "encrypted":
      return {
        code,
        message: `The ZIP archive${suffix} is encrypted; encrypted archives are not supported.`,
        hint: "Create a ZIP without a password, then retry the import."
      };
    case "unsupported-method":
      return {
        code,
        message: `The ZIP archive${suffix} uses a compression method this app does not support.`,
        hint: "Create the ZIP with standard deflate compression, then retry."
      };
    case "bad-crc":
      return {
        code,
        message: `A file in the ZIP archive${suffix} failed its checksum test.`,
        hint: "Download or copy the ZIP again; the file is damaged."
      };
    case "unsafe-path":
      return {
        code,
        message: `The ZIP archive${suffix} contains an entry with an unsafe path.`,
        hint: "Use a ZIP made from a trusted game installation."
      };
    case "missing-archives": {
      const names = detail.missing ?? [];
      const list = names.length > 0 ? names.join(", ") : "one or more required archives";
      return {
        code,
        message: `The ZIP archive${suffix} is missing required archives: ${list}.`,
        hint: "Add the missing archives to the ZIP, or select a complete one."
      };
    }
    case "quota-exceeded": {
      const hasSizes = typeof detail.needed === "number" && typeof detail.free === "number";
      const sizes = hasSizes ? `${formatBytes(detail.needed)} needed, ${formatBytes(detail.free)} free` : "not enough free space";
      return {
        code,
        message: `There is not enough storage space${suffix}: ${sizes}.`,
        hint: "Free up browser storage or choose a smaller ZIP, then retry."
      };
    }
    case "storage-unavailable":
      return {
        code,
        message: `Browser storage is unavailable${suffix}.`,
        hint: "Allow storage for this site in the browser settings, then retry."
      };
    case "read-failed":
      return {
        code,
        message: `The ZIP archive${suffix} could not be read.`,
        hint: "Retry the import; if it fails again, copy the ZIP again."
      };
    case "aborted":
      return {
        code,
        message: `The import${suffix} was cancelled before it finished.`,
        hint: "Start the import again when ready."
      };
    case "unknown":
    default:
      return {
        code,
        message: `The import${suffix} failed for an unexpected reason.`,
        hint: "Retry the import; if it keeps failing, report the problem."
      };
  }
}
function describeImportError(error) {
  if (error instanceof ImportError) {
    return describe(error.code, error.detail);
  }
  if (typeof DOMException !== "undefined" && error instanceof DOMException) {
    switch (error.name) {
      case "QuotaExceededError":
        return describe("quota-exceeded", {});
      case "AbortError":
        return describe("aborted", {});
      case "NotAllowedError":
      case "SecurityError":
      case "InvalidStateError":
        return describe("storage-unavailable", {});
    }
  }
  return describe("unknown", {});
}

// src/opfs-store.ts
var ROOT_DIR = "zhwp";
var KINDS = ["zh", "generals"];
async function createWritable(file) {
  const create = file.createWritable;
  return create.call(file, { keepExistingData: false });
}
async function kindDirectory(kind, create) {
  const root = await navigator.storage.getDirectory();
  let parent;
  try {
    parent = await root.getDirectoryHandle(ROOT_DIR, { create });
  } catch (error) {
    if (!create && error.name === "NotFoundError") return null;
    throw error;
  }
  try {
    return await parent.getDirectoryHandle(kind, { create });
  } catch (error) {
    if (!create && error.name === "NotFoundError") return null;
    throw error;
  }
}
var EXTRA_DIR = "extra";
var STAGING_DIR = "zhwp.tmp";
async function rootDirectory(create) {
  const root = await navigator.storage.getDirectory();
  try {
    return await root.getDirectoryHandle(ROOT_DIR, { create });
  } catch (error) {
    if (!create && error.name === "NotFoundError") return null;
    throw error;
  }
}
async function createParentDirectory(parts) {
  let dir = await rootDirectory(true);
  for (const segment of parts.slice(0, -1)) {
    dir = await dir.getDirectoryHandle(segment, { create: true });
  }
  return dir;
}
var createdParents = /* @__PURE__ */ new Map();
async function parentDirectory(parts, create) {
  if (!create) {
    let dir = await rootDirectory(false);
    if (dir === null) return null;
    for (const segment of parts.slice(0, -1)) {
      try {
        dir = await dir.getDirectoryHandle(segment, { create: false });
      } catch (error) {
        if (error.name === "NotFoundError") return null;
        throw error;
      }
    }
    return dir;
  }
  const key = parts.slice(0, -1).join("\0");
  let pending = createdParents.get(key);
  if (pending === void 0) {
    pending = createParentDirectory(parts);
    createdParents.set(key, pending);
    pending.catch(() => {
      if (createdParents.get(key) === pending) createdParents.delete(key);
    });
  }
  return pending;
}
var stagingParents = /* @__PURE__ */ new Map();
async function stagingDirectory(parts) {
  const key = parts.slice(0, -1).join("\0");
  let pending = stagingParents.get(key);
  if (pending === void 0) {
    pending = (async () => {
      const root = await navigator.storage.getDirectory();
      let dir = await root.getDirectoryHandle(STAGING_DIR, { create: true });
      for (const segment of parts.slice(0, -1)) {
        dir = await dir.getDirectoryHandle(segment, { create: true });
      }
      return dir;
    })();
    stagingParents.set(key, pending);
    pending.catch(() => {
      if (stagingParents.get(key) === pending) stagingParents.delete(key);
    });
  }
  return pending;
}
async function storedSnapshot() {
  const sizes = /* @__PURE__ */ new Map();
  const root = await rootDirectory(false);
  if (root === null) return sizes;
  const walk = async (dir, prefix) => {
    for await (const [name, handle] of dir.entries()) {
      const path = prefix === "" ? name : `${prefix}/${name}`;
      if (handle.kind === "directory") {
        await walk(handle, path);
      } else {
        const file = await handle.getFile();
        sizes.set(path, { existed: true, size: file.size });
      }
    }
  };
  await walk(root, "");
  return sizes;
}
async function openStoredFile(parts, known) {
  const dir = await parentDirectory(parts, true);
  const name = parts[parts.length - 1];
  let existed;
  let size;
  if (known !== void 0) {
    existed = known.existed;
    size = known.size;
  } else {
    try {
      const handle = await dir.getFileHandle(name, { create: false });
      existed = true;
      size = (await handle.getFile()).size;
    } catch (error) {
      if (error.name !== "NotFoundError") throw error;
      existed = false;
      size = 0;
    }
  }
  const stagingDir = await stagingDirectory(parts);
  const staging = await stagingDir.getFileHandle(name, { create: true });
  let writable;
  try {
    writable = await createWritable(staging);
  } catch (error) {
    await stagingDir.removeEntry(name).catch(() => void 0);
    throw error;
  }
  const commit = async () => {
    await writable.close();
    const move = staging.move;
    if (typeof move === "function") {
      await move.call(staging, dir, name);
      return;
    }
    const data = await staging.getFile();
    const final = await dir.getFileHandle(name, { create: true });
    const stream = await createWritable(final);
    try {
      await stream.write(data);
      await stream.close();
    } catch (error) {
      await stream.abort().catch(() => void 0);
      throw error;
    }
    await stagingDir.removeEntry(name).catch(() => void 0);
  };
  const abort = async () => {
    await writable.abort().catch(() => void 0);
    await stagingDir.removeEntry(name).catch(() => void 0);
  };
  return { writable, existed, size, commit, abort };
}
async function removeStoredFile(parts) {
  const dir = await parentDirectory(parts, false);
  if (dir === null) return;
  await dir.removeEntry(parts[parts.length - 1]).catch((error) => {
    if (error.name !== "NotFoundError") throw error;
  });
}
function abortError() {
  return new DOMException("The import was aborted", "AbortError");
}
async function removeEmptyDirectories(dir, signal) {
  const children = [];
  for await (const [name, handle] of dir.entries()) {
    if (handle.kind === "directory") {
      children.push([name, handle]);
    }
  }
  for (const [name, child] of children) {
    if (signal?.aborted) throw abortError();
    await removeEmptyDirectories(child, signal);
    let empty = true;
    for await (const _ of child.entries()) {
      empty = false;
      break;
    }
    if (empty) {
      if (signal?.aborted) throw abortError();
      await dir.removeEntry(name);
    }
  }
}
async function reconcileStored(keep, signal) {
  if (signal?.aborted) throw abortError();
  const snapshot = await storedSnapshot();
  if (signal?.aborted) throw abortError();
  const remaining = /* @__PURE__ */ new Map();
  let removed = 0;
  let freedBytes = 0;
  for (const [path, known] of snapshot) {
    const underInstall = KINDS.some((kind) => path.startsWith(`${kind}/`)) || path.startsWith(`${EXTRA_DIR}/`);
    if (!underInstall) {
      remaining.set(path, known);
      continue;
    }
    if (keep.get(path) === known.size) {
      remaining.set(path, known);
      continue;
    }
    if (signal?.aborted) throw abortError();
    await removeStoredFile(path.split("/"));
    removed++;
    freedBytes += known.size;
    if (signal?.aborted) throw abortError();
  }
  if (removed > 0) {
    createdParents.clear();
    const root = await rootDirectory(false);
    if (root !== null) {
      try {
        const extra = await root.getDirectoryHandle(EXTRA_DIR, { create: false });
        await removeEmptyDirectories(extra, signal);
      } catch (error) {
        if (error.name !== "NotFoundError") throw error;
      }
    }
  }
  return { removed, freedBytes, remaining };
}
async function findFile(kind, name) {
  const dir = await kindDirectory(kind, false);
  if (dir === null) return null;
  try {
    return await dir.getFileHandle(name, { create: false });
  } catch (error) {
    if (error.name === "NotFoundError") return null;
    throw error;
  }
}
async function storeFiles(entries, onProgress) {
  const total = entries.reduce((sum, entry) => sum + entry.file.size, 0);
  let done = 0;
  let written = 0;
  let skipped = 0;
  for (const entry of entries) {
    const existing = await findFile(entry.kind, entry.name);
    if (existing !== null && (await existing.getFile()).size === entry.file.size) {
      skipped++;
    } else {
      const target = await openStoredFile([entry.kind, entry.name]);
      try {
        await target.writable.write(entry.file);
        await target.commit();
      } catch (error) {
        await target.abort();
        throw error;
      }
      written++;
    }
    done += entry.file.size;
    onProgress?.(done, total);
  }
  return { written, skipped };
}
async function listStored() {
  const stored = [];
  for (const kind of KINDS) {
    const dir = await kindDirectory(kind, false);
    if (dir === null) continue;
    for await (const [name, handle] of dir.entries()) {
      if (handle.kind !== "file") continue;
      const size = await handle.getFile().then((f) => f.size);
      stored.push({ kind, name, size });
    }
  }
  stored.sort(
    (a, b) => KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind) || a.name.localeCompare(b.name)
  );
  return stored;
}
async function walkExtra(dir, prefix, files) {
  for await (const [name, handle] of dir.entries()) {
    const path = prefix === "" ? name : `${prefix}/${name}`;
    if (handle.kind === "directory") {
      await walkExtra(handle, path, files);
    } else {
      const size = await handle.getFile().then((f) => f.size);
      files.push({ path, size });
    }
  }
}
async function listExtra() {
  const root = await rootDirectory(false);
  if (root === null) return [];
  let extra;
  try {
    extra = await root.getDirectoryHandle(EXTRA_DIR, { create: false });
  } catch (error) {
    if (error.name === "NotFoundError") return [];
    throw error;
  }
  const files = [];
  await walkExtra(extra, "", files);
  files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  return files;
}
async function clearStored() {
  createdParents.clear();
  stagingParents.clear();
  const root = await navigator.storage.getDirectory();
  for (const name of [ROOT_DIR, STAGING_DIR]) {
    await root.removeEntry(name, { recursive: true }).catch((error) => {
      if (error.name !== "NotFoundError") throw error;
    });
  }
}

// src/bridge.ts
var REQ = 0;
var STATUS = 1;
var INDEX = 2;
var LENGTH = 3;
var ERROR = 4;
var CLOSE = 5;
var CONTROL_LEN = 6;
var BLOCK = 4 * 1024 * 1024;
var FileBridge = class _FileBridge {
  constructor(worker, shared, files, readTimeoutMs) {
    this.worker = worker;
    this.shared = shared;
    this.files = files;
    this.readTimeoutMs = readTimeoutMs;
  }
  worker;
  shared;
  files;
  readTimeoutMs;
  static DEFAULT_READ_TIMEOUT_MS = 1e4;
  dead = false;
  closeStarted = false;
  static async start(files, workerUrl, options) {
    const timeout = options?.readTimeoutMs;
    const readTimeoutMs = timeout === void 0 ? _FileBridge.DEFAULT_READ_TIMEOUT_MS : timeout;
    const url = workerUrl ?? new URL("./bridge-worker.js", import.meta.url);
    const worker = new Worker(url, { type: "module" });
    const controlBuffer = new SharedArrayBuffer(CONTROL_LEN * 4 + 8);
    const dataBuffer = new SharedArrayBuffer(BLOCK);
    const shared = {
      control: new Int32Array(controlBuffer),
      position: new Float64Array(controlBuffer, CONTROL_LEN * 4, 1),
      data: new Uint8Array(dataBuffer)
    };
    let failure = "";
    const ready = new Promise((resolve, reject) => {
      worker.onmessage = (event) => {
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
        data: dataBuffer
      },
      []
    );
    try {
      await ready;
    } catch (error) {
      worker.terminate();
      throw error;
    }
    return new _FileBridge(worker, shared, files, readTimeoutMs);
  }
  size(kind, name) {
    const index = this.index(kind, name);
    return this.files[index].size;
  }
  readSync(kind, name, position, target) {
    if (this.dead || this.closeStarted) throw new Error(`bridge closed: cannot read ${kind}/${name}`);
    const index = this.index(kind, name);
    const file = this.files[index];
    if (!Number.isFinite(position) || position < 0) throw new Error(`bad read position: ${position}`);
    if (position >= file.size) return 0;
    const wanted = Math.min(target.length, file.size - position);
    let readTotal = 0;
    while (readTotal < wanted) {
      const chunk = Math.min(BLOCK, wanted - readTotal);
      let read;
      try {
        read = this.request(index, position + readTotal, chunk);
      } catch (error) {
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
  async close() {
    if (this.dead || this.closeStarted) return;
    this.closeStarted = true;
    const { control } = this.shared;
    Atomics.store(control, CLOSE, 1);
    Atomics.store(control, REQ, 1);
    Atomics.notify(control, REQ);
    if (this.spin(() => Atomics.load(control, CLOSE) === 0)) {
      this.dead = true;
      this.worker.terminate();
    } else {
      this.giveUp();
    }
  }
  index(kind, name) {
    const index = this.files.findIndex((file) => file.kind === kind && file.name === name);
    if (index < 0) throw new Error(`unknown file: ${kind}/${name}`);
    return index;
  }
  request(index, position, length) {
    const { control, data, position: positionView } = this.shared;
    positionView[0] = position;
    Atomics.store(control, INDEX, index);
    Atomics.store(control, LENGTH, length);
    Atomics.store(control, STATUS, 0);
    Atomics.store(control, REQ, 1);
    Atomics.notify(control, REQ);
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
  giveUp() {
    this.dead = true;
    this.worker.terminate();
  }
  // Busy-wait: the worker answers in microseconds and cannot wake us. The
  // time limit is checked every 1024 iterations so a stalled worker cannot
  // block the main thread forever. Returns false on time-out.
  spin(done) {
    let iterations = 0;
    const deadline = performance.now() + this.readTimeoutMs;
    while (!done()) {
      if ((++iterations & 1023) === 0 && performance.now() >= deadline) return false;
    }
    return true;
  }
};

// src/zip.ts
var LOCAL_HEADER_SIGNATURE = 67324752;
var CENTRAL_HEADER_SIGNATURE = 33639248;
var EOCD_SIGNATURE = 101010256;
var ZIP64_LOCATOR_SIGNATURE = 117853008;
var ZIP64_EOCD_SIGNATURE = 101075792;
var ZIP64_EXTRA_ID = 1;
var EOCD_SIZE = 22;
var ZIP64_LOCATOR_SIZE = 20;
var ZIP64_EOCD_SIZE = 56;
var LOCAL_HEADER_SIZE = 30;
var MAX_COMMENT = 65535;
var CHUNK_SIZE = 1024 * 1024;
var CRC32_INIT = 4294967295;
var CRC_TABLES = (() => {
  const tables = [new Uint32Array(256)];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 3988292384 ^ c >>> 1 : c >>> 1;
    tables[0][n] = c >>> 0;
  }
  for (let n = 1; n < 8; n++) {
    const previous = tables[n - 1];
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      table[i] = previous[i] >>> 8 ^ tables[0][previous[i] & 255];
    }
    tables.push(table);
  }
  return tables;
})();
var decoder = new TextDecoder();
function crc32Update(crc, data) {
  let value = crc >>> 0;
  let i = 0;
  const length = data.length;
  if (length >= 8 && data.byteOffset % 4 === 0) {
    const words = length >>> 2;
    const view = new Uint32Array(data.buffer, data.byteOffset, words);
    const pairs = words - words % 2;
    const [t0, t1, t2, t3, t4, t5, t6, t7] = CRC_TABLES;
    for (let word = 0; word < pairs; word += 2) {
      const a = (view[word] ^ value) >>> 0;
      const b = view[word + 1];
      value = t7[a & 255] ^ t6[a >>> 8 & 255] ^ t5[a >>> 16 & 255] ^ t4[a >>> 24] ^ t3[b & 255] ^ t2[b >>> 8 & 255] ^ t1[b >>> 16 & 255] ^ t0[b >>> 24];
    }
    i = pairs << 2;
  }
  const table = CRC_TABLES[0];
  for (; i < length; i++) value = table[(value ^ data[i]) & 255] ^ value >>> 8;
  return value >>> 0;
}
function crc32Value(crc) {
  return (crc ^ 4294967295) >>> 0;
}
function viewOf(bytes) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}
function u16(view, at) {
  return view.getUint16(at, true);
}
function u32(view, at) {
  return view.getUint32(at, true);
}
function u64(view, at) {
  return view.getUint32(at, true) + view.getUint32(at + 4, true) * 4294967296;
}
function fail(code, file) {
  return new ImportError(code, file === void 0 ? void 0 : { file });
}
async function readRange(blob, start, length, file) {
  if (start < 0 || length < 0 || start + length > blob.size) {
    throw fail("truncated", file);
  }
  if (length === 0) return new Uint8Array(0);
  const bytes = new Uint8Array(await blob.slice(start, start + length).arrayBuffer());
  if (bytes.length !== length) throw fail("truncated", file);
  return bytes;
}
async function findEocd(blob) {
  if (blob.size < EOCD_SIZE) throw fail("not-a-zip");
  const tailStart = blob.size - EOCD_SIZE;
  const tail = await readRange(blob, tailStart, EOCD_SIZE);
  const tailView = viewOf(tail);
  if (u32(tailView, 0) === EOCD_SIGNATURE && tailStart + EOCD_SIZE + u16(tailView, 20) === blob.size) {
    return { bytes: tail, start: tailStart, at: 0 };
  }
  const span = Math.min(blob.size, EOCD_SIZE + MAX_COMMENT);
  const start = blob.size - span;
  const bytes = await readRange(blob, start, span);
  const view = viewOf(bytes);
  for (let at = bytes.length - EOCD_SIZE; at >= 0; at--) {
    if (u32(view, at) !== EOCD_SIGNATURE) continue;
    if (start + at + EOCD_SIZE + u16(view, at + 20) === blob.size) {
      return { bytes, start, at };
    }
  }
  throw fail("not-a-zip");
}
function findZip64Extra(view, extraStart, extraLength) {
  let at = extraStart;
  const end = extraStart + extraLength;
  while (at + 4 <= end) {
    const id = u16(view, at);
    const length = u16(view, at + 2);
    const next = at + 4 + length;
    if (next > end) return void 0;
    if (id === ZIP64_EXTRA_ID) return { start: at + 4, end: next };
    at = next;
  }
  return void 0;
}
function parseCentralDirectory(bytes, entryCount) {
  const view = viewOf(bytes);
  const entries = [];
  let at = 0;
  for (let index = 0; index < entryCount; index++) {
    if (at + 46 > bytes.length) throw fail("truncated");
    if (u32(view, at) !== CENTRAL_HEADER_SIGNATURE) throw fail("truncated");
    const flags = u16(view, at + 8);
    const method = u16(view, at + 10);
    const crc32 = u32(view, at + 16);
    let compressedSize = u32(view, at + 20);
    let size = u32(view, at + 24);
    const nameLength = u16(view, at + 28);
    const extraLength = u16(view, at + 30);
    const commentLength = u16(view, at + 32);
    let diskStart = u16(view, at + 34);
    let offset = u32(view, at + 42);
    const recordEnd = at + 46 + nameLength + extraLength + commentLength;
    if (recordEnd > bytes.length) throw fail("truncated");
    const nameStart = at + 46;
    const extraStart = nameStart + nameLength;
    if (size === 4294967295 || compressedSize === 4294967295 || offset === 4294967295 || diskStart === 65535) {
      const extra = findZip64Extra(view, extraStart, extraLength);
      if (extra === void 0) throw fail("truncated");
      let field = extra.start;
      if (size === 4294967295) {
        if (field + 8 > extra.end) throw fail("truncated");
        size = u64(view, field);
        field += 8;
      }
      if (compressedSize === 4294967295) {
        if (field + 8 > extra.end) throw fail("truncated");
        compressedSize = u64(view, field);
        field += 8;
      }
      if (offset === 4294967295) {
        if (field + 8 > extra.end) throw fail("truncated");
        offset = u64(view, field);
        field += 8;
      }
      if (diskStart === 65535) {
        if (field + 4 > extra.end) throw fail("truncated");
        diskStart = u32(view, field);
      }
    }
    const path = decoder.decode(bytes.subarray(nameStart, nameStart + nameLength));
    if ((flags & 1) !== 0) throw fail("encrypted", path);
    if (method !== 0 && method !== 8) throw fail("unsupported-method", path);
    if (diskStart !== 0) throw fail("multi-disk", path);
    if (isUnsafePath(path)) throw fail("unsafe-path", path);
    entries.push({
      path,
      size,
      compressedSize,
      method,
      crc32,
      isDirectory: path.endsWith("/"),
      offset
    });
    at = recordEnd;
  }
  return { entries };
}
function isUnsafePath(path) {
  if (path.startsWith("/")) return true;
  if (path.includes("\\") || path.includes("\0")) return true;
  if (/^[A-Za-z]:/.test(path)) return true;
  return path.split("/").includes("..");
}
async function openZip(blob) {
  const location = await findEocd(blob);
  const view = viewOf(location.bytes);
  const at = location.at;
  const eocdOffset = location.start + at;
  const disk = u16(view, at + 4);
  const centralDisk = u16(view, at + 6);
  let entryCount = u16(view, at + 10);
  let centralSize = u32(view, at + 12);
  let centralOffset = u32(view, at + 16);
  const zip64 = entryCount === 65535 || centralSize === 4294967295 || centralOffset === 4294967295;
  if (zip64) {
    if (eocdOffset < ZIP64_LOCATOR_SIZE) throw fail("truncated");
    const locator = await readRange(
      blob,
      eocdOffset - ZIP64_LOCATOR_SIZE,
      ZIP64_LOCATOR_SIZE
    );
    const locatorView = viewOf(locator);
    if (u32(locatorView, 0) !== ZIP64_LOCATOR_SIGNATURE) throw fail("truncated");
    if (u32(locatorView, 4) !== 0) throw fail("multi-disk");
    const recordOffset = u64(locatorView, 8);
    const record = await readRange(blob, recordOffset, ZIP64_EOCD_SIZE);
    const recordView = viewOf(record);
    if (u32(recordView, 0) !== ZIP64_EOCD_SIGNATURE) throw fail("truncated");
    if (u32(recordView, 16) !== 0 || u32(recordView, 20) !== 0) throw fail("multi-disk");
    entryCount = u64(recordView, 32);
    centralSize = u64(recordView, 40);
    centralOffset = u64(recordView, 48);
  } else if (disk !== 0 || centralDisk !== 0) {
    throw fail("multi-disk");
  }
  if (centralOffset + centralSize > blob.size) throw fail("truncated");
  const centralBytes = await readRange(blob, centralOffset, centralSize);
  return parseCentralDirectory(centralBytes, entryCount).entries;
}
function chunkStream(blob, start, length, file) {
  let at = start;
  const end = start + length;
  let reader = null;
  return new ReadableStream({
    async pull(controller) {
      for (; ; ) {
        if (reader === null) {
          if (at >= end) {
            controller.close();
            return;
          }
          const size = Math.min(CHUNK_SIZE, end - at);
          const part = blob.slice(at, at + size);
          if (part.size !== size) throw fail("truncated", file);
          at += size;
          reader = part.stream().getReader();
        }
        const result = await reader.read();
        if (result.done) {
          reader = null;
          continue;
        }
        controller.enqueue(result.value);
        return;
      }
    },
    cancel(reason) {
      if (reader === null) return;
      const active = reader;
      reader = null;
      return active.cancel(reason);
    }
  });
}
async function localDataRange(blob, entry) {
  if (entry.method !== 0 && entry.method !== 8) {
    throw fail("unsupported-method", entry.path);
  }
  if (entry.offset + LOCAL_HEADER_SIZE > blob.size) {
    throw fail("truncated", entry.path);
  }
  const header = await readRange(blob, entry.offset, LOCAL_HEADER_SIZE, entry.path);
  const view = viewOf(header);
  if (u32(view, 0) !== LOCAL_HEADER_SIGNATURE) throw fail("truncated", entry.path);
  if ((u16(view, 6) & 1) !== 0) throw fail("encrypted", entry.path);
  const nameLength = u16(view, 26);
  const extraLength = u16(view, 28);
  const start = entry.offset + LOCAL_HEADER_SIZE + nameLength + extraLength;
  if (start + entry.compressedSize > blob.size) throw fail("truncated", entry.path);
  return { start, length: entry.compressedSize };
}
async function entryDataBlob(blob, entry) {
  const range = await localDataRange(blob, entry);
  return blob.slice(range.start, range.start + range.length);
}
var MAX_HEADER_FIELDS = LOCAL_HEADER_SIZE + 65535 + 65535;
async function openEntryReader(blob, entry) {
  const range = await localDataRange(blob, entry);
  let source = chunkStream(blob, range.start, range.length, entry.path);
  if (entry.method === 8) {
    source = source.pipeThrough(new DecompressionStream("deflate-raw"));
  }
  return source.getReader();
}
function normalizeError(error, path) {
  if (error instanceof ImportError) return error;
  return new ImportError("truncated", { file: path }, error);
}
function entryStream(blob, entry) {
  let reader = null;
  let crc = CRC32_INIT;
  let total = 0;
  let finished = false;
  return new ReadableStream({
    async pull(controller) {
      if (finished) return;
      try {
        if (reader === null) reader = await openEntryReader(blob, entry);
        const result = await reader.read();
        if (result.done) {
          finished = true;
          const actual = crc32Value(crc);
          if (total !== entry.size || actual !== entry.crc32) {
            throw fail("bad-crc", entry.path);
          }
          controller.close();
          reader.releaseLock();
          reader = null;
          return;
        }
        const value = result.value;
        crc = crc32Update(crc, value);
        total += value.length;
        controller.enqueue(value);
      } catch (error) {
        finished = true;
        controller.error(normalizeError(error, entry.path));
        if (reader !== null) {
          const active = reader;
          reader = null;
          active.cancel().catch(() => void 0);
        }
      }
    },
    cancel(reason) {
      if (reader === null) return;
      const active = reader;
      reader = null;
      return active.cancel(reason);
    }
  });
}

// src/zip-import.ts
var STORAGE_ERRORS = /* @__PURE__ */ new Set([
  "NotAllowedError",
  "SecurityError",
  "InvalidStateError",
  "NotFoundError",
  "NoModificationAllowedError",
  "TypeMismatchError"
]);
var THROTTLE_MS = 100;
var WINDOW_MS = 3e3;
var ETA_AFTER_MS = 1e3;
var CRC_CHUNK_SIZE = 1024 * 1024;
var INFLATE_WRITE_CHUNK = 8 * 1024 * 1024;
function now() {
  return performance.now();
}
function archiveOf(path) {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const lower = name.toLowerCase();
  if (!lower.endsWith(".big") || lower === ".big") return null;
  return { kind: lower.endsWith("zh.big") ? "zh" : "generals", name };
}
function archiveKey(archive) {
  return `${archive.kind}\0${archive.name.toLowerCase()}`;
}
function errorName(error) {
  const name = error?.name;
  return typeof name === "string" ? name : "";
}
async function freeBytes() {
  try {
    const estimate = await navigator.storage.estimate();
    if (typeof estimate.quota !== "number") return void 0;
    const free = estimate.quota - (estimate.usage ?? 0);
    return Number.isFinite(free) ? free : void 0;
  } catch {
    return void 0;
  }
}
async function toImportError(error, file, needed) {
  if (error instanceof ImportError) return error;
  const name = errorName(error);
  if (name === "AbortError") return new ImportError("aborted");
  if (name === "QuotaExceededError") {
    const detail2 = { needed };
    const free = await freeBytes();
    if (free !== void 0) detail2.free = free;
    return new ImportError("quota-exceeded", detail2);
  }
  const detail = file === void 0 ? {} : { file };
  if (STORAGE_ERRORS.has(name)) return new ImportError("storage-unavailable", detail);
  return new ImportError("read-failed", detail, error);
}
function aborted() {
  return new ImportError("aborted");
}
async function importZips(zips, options) {
  const signal = options?.signal;
  const onProgress = options?.onProgress;
  const onPhase = options?.onPhase;
  if (signal?.aborted) throw aborted();
  const opened = [];
  const paths = [];
  for (const blob of zips) {
    let entries;
    try {
      entries = await openZip(blob);
    } catch (error) {
      const file = blob instanceof File ? blob.name : void 0;
      throw await toImportError(error, file, 0);
    }
    if (signal?.aborted) throw aborted();
    opened.push({ blob, entries });
    for (const entry of entries) {
      if (!entry.isDirectory) paths.push(entry.path);
    }
  }
  const report = classifyArchives(paths);
  if (report.missing.length > 0) {
    throw new ImportError("missing-archives", { missing: report.missing });
  }
  const selected = new Set(report.archives.map((archive) => archiveKey(archive)));
  const archiveSizes = /* @__PURE__ */ new Map();
  const seenArchives = /* @__PURE__ */ new Set();
  const plan = [];
  for (const source of opened) {
    for (const entry of source.entries) {
      if (entry.isDirectory) continue;
      const archive = archiveOf(entry.path);
      if (archive === null) continue;
      const key = archiveKey(archive);
      const first = selected.has(key) && !seenArchives.has(key);
      if (first) {
        seenArchives.add(key);
        archiveSizes.set(key, entry.size);
      }
      plan.push({
        blob: source.blob,
        entry,
        parts: first ? [archive.kind, archive.name] : null
      });
    }
  }
  const archives = report.archives.map((archive) => {
    const key = archiveKey(archive);
    return { kind: archive.kind, name: archive.name, size: archiveSizes.get(key) ?? 0 };
  });
  const incoming = /* @__PURE__ */ new Map();
  for (const file of plan) {
    if (file.parts === null) continue;
    const key = file.parts.join("/");
    if (!incoming.has(key)) incoming.set(key, file.entry.size);
  }
  onPhase?.("removing");
  let reconciled;
  try {
    reconciled = await reconcileStored(incoming, signal);
  } catch (error) {
    if (signal?.aborted) throw aborted();
    throw new ImportError("storage-unavailable", {}, error);
  }
  onPhase?.("importing");
  const totalBytes = plan.reduce((sum, file) => sum + file.entry.size, 0);
  const filesTotal = plan.length;
  let doneBytes = 0;
  let committedBytes = 0;
  let filesDone = 0;
  let written = 0;
  let skipped = 0;
  const startedAt = now();
  let lastEmitAt = Number.NEGATIVE_INFINITY;
  const samples = [];
  const emit = (currentFile, force) => {
    const at = now();
    if (!force && at - lastEmitAt < THROTTLE_MS) return;
    lastEmitAt = at;
    samples.push({ at, bytes: doneBytes });
    while (samples.length > 2 && at - samples[0].at > WINDOW_MS) samples.shift();
    const first = samples[0];
    const seconds = (at - first.at) / 1e3;
    const measured = seconds > 0 ? (doneBytes - first.bytes) / seconds : 0;
    const bytesPerSecond = Number.isFinite(measured) && measured > 0 ? measured : 0;
    let etaSeconds = null;
    if (at - startedAt >= ETA_AFTER_MS) {
      if (bytesPerSecond > 0) {
        const eta = (totalBytes - doneBytes) / bytesPerSecond;
        if (Number.isFinite(eta)) etaSeconds = Math.max(0, eta);
      } else if (doneBytes >= totalBytes) {
        etaSeconds = 0;
      }
    }
    onProgress?.({
      doneBytes,
      totalBytes,
      filesDone,
      filesTotal,
      currentFile,
      bytesPerSecond,
      etaSeconds
    });
  };
  emit(plan.length === 0 ? "" : plan[0].entry.path, true);
  const known = reconciled.remaining;
  if (signal?.aborted) throw aborted();
  const knownOf = (parts) => known.get(parts.join("/")) ?? { existed: false, size: 0 };
  const addBytes = (file, count) => {
    doneBytes += count;
    emit(file.entry.path, false);
  };
  const countSkipped = (file) => {
    doneBytes += file.entry.size;
    committedBytes += file.entry.size;
    filesDone++;
    skipped++;
    emit(file.entry.path, true);
  };
  const countWritten = (file) => {
    committedBytes += file.entry.size;
    filesDone++;
    written++;
    emit(file.entry.path, true);
  };
  const discard = async (target, parts) => {
    await target.abort();
    if (!target.existed) await removeStoredFile(parts).catch(() => void 0);
  };
  const dispatchStored = async (file, target) => {
    const data = await entryDataBlob(file.blob, file.entry);
    if (signal?.aborted) throw aborted();
    let writing = null;
    if (data.size > 0) {
      writing = target.writable.write(data);
      writing.catch(() => void 0);
    }
    return { file, target, writing, data, verified: false };
  };
  const verifyStored = async (prepared, ignoreAbort = false) => {
    if (prepared.data === null || prepared.verified) return;
    const data = prepared.data;
    let crc = CRC32_INIT;
    let total = 0;
    let pending = data.size > 0 ? data.slice(0, Math.min(CRC_CHUNK_SIZE, data.size)).arrayBuffer() : null;
    pending?.catch(() => void 0);
    for (let at = 0; at < data.size; ) {
      if (!ignoreAbort && signal?.aborted) throw aborted();
      const bytes = new Uint8Array(await pending);
      const next = at + CRC_CHUNK_SIZE;
      pending = next < data.size ? data.slice(next, Math.min(next + CRC_CHUNK_SIZE, data.size)).arrayBuffer() : null;
      pending?.catch(() => void 0);
      crc = crc32Update(crc, bytes);
      total += bytes.length;
      at = next;
      addBytes(prepared.file, bytes.length);
    }
    if (total !== prepared.file.entry.size || crc32Value(crc) !== prepared.file.entry.crc32) {
      throw new ImportError("bad-crc", { file: prepared.file.entry.path });
    }
    prepared.verified = true;
  };
  const writeInflatedData = async (file, target) => {
    const compressed = await entryDataBlob(file.blob, file.entry);
    const reader = compressed.stream().pipeThrough(new DecompressionStream("deflate-raw")).getReader();
    const bufferSize = Math.min(INFLATE_WRITE_CHUNK, Math.max(file.entry.size, 1));
    let buffer = new Uint8Array(bufferSize);
    let used = 0;
    let crc = CRC32_INIT;
    let total = 0;
    let writing = null;
    const flush = async () => {
      if (used === 0) return;
      const out = buffer.subarray(0, used);
      buffer = new Uint8Array(bufferSize);
      used = 0;
      const previous = writing;
      const write = target.writable.write(out);
      write.catch(() => void 0);
      writing = write;
      if (previous !== null) await previous;
    };
    try {
      for (; ; ) {
        if (signal?.aborted) throw aborted();
        let chunk;
        try {
          chunk = await reader.read();
        } catch (error) {
          if (error instanceof ImportError) throw error;
          throw new ImportError("truncated", { file: file.entry.path }, error);
        }
        if (chunk.done) break;
        if (signal?.aborted) throw aborted();
        const value = chunk.value;
        crc = crc32Update(crc, value);
        total += value.length;
        let at = 0;
        while (at < value.length) {
          const take = Math.min(bufferSize - used, value.length - at);
          buffer.set(value.subarray(at, at + take), used);
          used += take;
          at += take;
          if (used === bufferSize) await flush();
        }
        addBytes(file, value.length);
      }
      await flush();
      if (writing !== null) await writing;
      if (total !== file.entry.size || crc32Value(crc) !== file.entry.crc32) {
        throw new ImportError("bad-crc", { file: file.entry.path });
      }
    } catch (error) {
      reader.cancel().catch(() => void 0);
      if (writing !== null) await writing.catch(() => void 0);
      throw error;
    }
  };
  const abortPrepared = async (prepared) => {
    if (prepared.target !== null) {
      await discard(prepared.target, prepared.file.parts);
    }
    if (prepared.writing !== null) await prepared.writing.catch(() => void 0);
  };
  const dispatchLarge = async (file) => {
    if (file.parts === null) {
      return { file, target: null, writing: null, data: null, verified: true };
    }
    const parts = file.parts;
    const target = await openStoredFile(parts, knownOf(parts));
    if (target.existed && target.size === file.entry.size) {
      await target.abort();
      return { file, target: null, writing: null, data: null, verified: true };
    }
    try {
      if (file.entry.method === 0) return await dispatchStored(file, target);
      await writeInflatedData(file, target);
      return { file, target, writing: null, data: null, verified: true };
    } catch (error) {
      await discard(target, parts);
      throw await toImportError(error, file.entry.path, totalBytes - committedBytes);
    }
  };
  const dispatchLargeGroup = async (files) => {
    const pending = [];
    let failure = null;
    let failedAt = files.length;
    for (const file of files) {
      if (signal?.aborted) {
        failure = aborted();
        failedAt = pending.length;
        break;
      }
      try {
        pending.push(await dispatchLarge(file));
      } catch (error) {
        failure = error;
        failedAt = pending.length;
        break;
      }
      if (signal?.aborted) {
        failure = aborted();
        failedAt = pending.length - 1;
        break;
      }
    }
    return { pending, failure, failedAt };
  };
  const verifyLargeGroup = async (pending) => {
    for (let index = 0; index < pending.length; index++) {
      try {
        await verifyStored(pending[index]);
      } catch (error) {
        return { failure: error, failedAt: index };
      }
    }
    return { failure: null, failedAt: pending.length };
  };
  const commitPrepared = async (prepared) => {
    const { file, target, writing } = prepared;
    if (target === null) {
      countSkipped(file);
      return;
    }
    try {
      if (writing !== null) await writing;
      await target.commit();
    } catch (error) {
      await discard(target, file.parts);
      throw await toImportError(error, file.entry.path, totalBytes - committedBytes);
    }
    countWritten(file);
  };
  const abortRemaining = async (pending, from) => {
    for (let index = from; index < pending.length; index++) {
      await abortPrepared(pending[index]);
    }
  };
  const finishLargeFailure = async (group2) => {
    for (let index = 0; index < group2.failedAt; index++) {
      const prepared = group2.pending[index];
      try {
        await verifyStored(prepared, true);
        await commitPrepared(prepared);
      } catch (error) {
        await abortRemaining(group2.pending, index);
        throw error;
      }
    }
    await abortRemaining(group2.pending, group2.failedAt);
  };
  if (signal?.aborted) throw aborted();
  const group = await dispatchLargeGroup(plan);
  if (group.failure !== null) {
    await finishLargeFailure(group);
    throw group.failure;
  }
  const verified = await verifyLargeGroup(group.pending);
  if (verified.failure !== null) {
    await finishLargeFailure({
      pending: group.pending,
      failure: verified.failure,
      failedAt: verified.failedAt
    });
    throw verified.failure;
  }
  let committed = 0;
  try {
    while (committed < group.pending.length) {
      if (signal?.aborted) throw aborted();
      await commitPrepared(group.pending[committed]);
      committed++;
    }
  } catch (error) {
    await abortRemaining(group.pending, committed + 1);
    throw error;
  }
  if (doneBytes !== totalBytes) {
    throw new ImportError("read-failed", { file: plan[plan.length - 1].entry.path });
  }
  emit(plan.length === 0 ? "" : plan[plan.length - 1].entry.path, true);
  return {
    written,
    skipped,
    archives,
    extra: 0,
    removed: reconciled.removed,
    freedBytes: reconciled.freedBytes
  };
}

// src/zip-write.ts
var MAX_ENTRIES = 65535;
var MAX_BYTES = 4294967295;
var LOCAL_HEADER_SIZE2 = 30;
var CENTRAL_HEADER_SIZE = 46;
var EOCD_SIZE2 = 22;
var UTF8_FLAG = 2048;
var encoder = new TextEncoder();
function fail2(message) {
  return new Error(`zip-write: ${message}`);
}
function validatePath(path) {
  if (path.length === 0) throw fail2("empty entry path");
  if (path.startsWith("/")) throw fail2(`absolute entry path: ${path}`);
  if (path.endsWith("/")) throw fail2(`directory entry path: ${path}`);
  const segments = path.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    throw fail2(`entry path leaves the archive root: ${path}`);
  }
}
function dosDateTime(mtime) {
  let when = new Date(mtime ?? Date.now());
  if (Number.isNaN(when.getTime())) when = /* @__PURE__ */ new Date();
  const year = Math.min(2107, Math.max(1980, when.getFullYear()));
  const time = when.getHours() << 11 | when.getMinutes() << 5 | when.getSeconds() >> 1;
  const date = year - 1980 << 9 | when.getMonth() + 1 << 5 | when.getDate();
  return { time, date };
}
function buildZip(entries) {
  if (entries.length > MAX_ENTRIES) throw fail2(`too many entries: ${entries.length}`);
  const seen = /* @__PURE__ */ new Set();
  const prepared = [];
  let localBytes = 0;
  for (const entry of entries) {
    validatePath(entry.path);
    if (seen.has(entry.path)) throw fail2(`duplicate entry path: ${entry.path}`);
    seen.add(entry.path);
    const name = encoder.encode(entry.path);
    const data = entry.data;
    const { time, date } = dosDateTime(entry.mtime);
    const offset = localBytes;
    localBytes += LOCAL_HEADER_SIZE2 + name.length + data.length;
    if (localBytes > MAX_BYTES) throw fail2("archive is larger than 4 GiB");
    prepared.push({
      name,
      data,
      crc: crc32Value(crc32Update(CRC32_INIT, data)),
      time,
      date,
      offset
    });
  }
  let centralBytes = 0;
  for (const entry of prepared) centralBytes += CENTRAL_HEADER_SIZE + entry.name.length;
  const total = localBytes + centralBytes + EOCD_SIZE2;
  if (total > MAX_BYTES) throw fail2("archive is larger than 4 GiB");
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  let at = 0;
  for (const entry of prepared) {
    view.setUint32(at, 67324752, true);
    view.setUint16(at + 4, 20, true);
    view.setUint16(at + 6, UTF8_FLAG, true);
    view.setUint16(at + 8, 0, true);
    view.setUint16(at + 10, entry.time, true);
    view.setUint16(at + 12, entry.date, true);
    view.setUint32(at + 14, entry.crc, true);
    view.setUint32(at + 18, entry.data.length, true);
    view.setUint32(at + 22, entry.data.length, true);
    view.setUint16(at + 26, entry.name.length, true);
    view.setUint16(at + 28, 0, true);
    out.set(entry.name, at + LOCAL_HEADER_SIZE2);
    out.set(entry.data, at + LOCAL_HEADER_SIZE2 + entry.name.length);
    at += LOCAL_HEADER_SIZE2 + entry.name.length + entry.data.length;
  }
  const centralOffset = at;
  for (const entry of prepared) {
    view.setUint32(at, 33639248, true);
    view.setUint16(at + 4, 20, true);
    view.setUint16(at + 6, 20, true);
    view.setUint16(at + 8, UTF8_FLAG, true);
    view.setUint16(at + 10, 0, true);
    view.setUint16(at + 12, entry.time, true);
    view.setUint16(at + 14, entry.date, true);
    view.setUint32(at + 16, entry.crc, true);
    view.setUint32(at + 20, entry.data.length, true);
    view.setUint32(at + 24, entry.data.length, true);
    view.setUint16(at + 28, entry.name.length, true);
    view.setUint16(at + 30, 0, true);
    view.setUint16(at + 32, 0, true);
    view.setUint16(at + 34, 0, true);
    view.setUint16(at + 36, 0, true);
    view.setUint32(at + 38, 0, true);
    view.setUint32(at + 42, entry.offset, true);
    out.set(entry.name, at + CENTRAL_HEADER_SIZE);
    at += CENTRAL_HEADER_SIZE + entry.name.length;
  }
  const centralSize = at - centralOffset;
  view.setUint32(at, 101010256, true);
  view.setUint16(at + 4, 0, true);
  view.setUint16(at + 6, 0, true);
  view.setUint16(at + 8, prepared.length, true);
  view.setUint16(at + 10, prepared.length, true);
  view.setUint32(at + 12, centralSize, true);
  view.setUint32(at + 16, centralOffset, true);
  view.setUint16(at + 20, 0, true);
  return new Blob([out], { type: "application/zip" });
}

// src/saves.ts
var USER_DATA_DB_NAME = "/home/web_user/.local/share/GeneralsX";
var SAVE_DIR = `${USER_DATA_DB_NAME}/GeneralsZH/Save`;
var IDBFS_DB_VERSION = 21;
var IDBFS_STORE_NAME = "FILE_DATA";
var S_IFMT = 61440;
var S_IFREG = 32768;
function deleteDatabase(name) {
  return new Promise((resolve) => {
    let request;
    try {
      request = indexedDB.deleteDatabase(name);
    } catch {
      resolve();
      return;
    }
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
}
async function openUserDataDb() {
  if (typeof indexedDB === "undefined") return null;
  let created = false;
  const request = indexedDB.open(USER_DATA_DB_NAME, IDBFS_DB_VERSION);
  request.onupgradeneeded = (event) => {
    created = event.oldVersion === 0;
    const db2 = request.result;
    if (!db2.objectStoreNames.contains(IDBFS_STORE_NAME)) {
      const store = db2.createObjectStore(IDBFS_STORE_NAME);
      store.createIndex("timestamp", "timestamp", { unique: false });
    }
  };
  const db = await new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("user data database failed to open"));
    request.onblocked = () => reject(new Error("user data database is blocked"));
  });
  if (created) {
    db.close();
    await deleteDatabase(USER_DATA_DB_NAME);
    return null;
  }
  if (!db.objectStoreNames.contains(IDBFS_STORE_NAME)) {
    db.close();
    return null;
  }
  return db;
}
function copyContents(contents) {
  if (contents instanceof Uint8Array) return contents.slice();
  return new Uint8Array(contents.slice(0));
}
async function listSavedGames() {
  const db = await openUserDataDb();
  if (db === null) return [];
  try {
    const transaction = db.transaction(IDBFS_STORE_NAME, "readonly");
    const store = transaction.objectStore(IDBFS_STORE_NAME);
    const games = await new Promise((resolve, reject) => {
      const games2 = [];
      const cursorRequest = store.openCursor();
      cursorRequest.onerror = () => reject(cursorRequest.error ?? new Error("user data read failed"));
      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;
        if (cursor === null) {
          resolve(games2);
          return;
        }
        const key = String(cursor.key);
        const entry = cursor.value;
        if (key.startsWith(`${SAVE_DIR}/`) && typeof entry.mode === "number" && (entry.mode & S_IFMT) === S_IFREG && entry.contents !== void 0) {
          const path = key.slice(SAVE_DIR.length + 1);
          if (path.length > 0) {
            games2.push({
              path,
              data: copyContents(entry.contents),
              // Emscripten stores a Date; the seeded tests use a number.
              timestamp: entry.timestamp instanceof Date ? entry.timestamp.getTime() : typeof entry.timestamp === "number" ? entry.timestamp : 0
            });
          }
        }
        cursor.continue();
      };
    });
    return games.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  } finally {
    db.close();
  }
}
async function savedGamesZip(flush) {
  if (flush !== void 0) await flush();
  const games = await listSavedGames();
  if (games.length === 0) return null;
  const blob = buildZip(
    games.map((game) => ({ path: game.path, data: game.data, mtime: game.timestamp }))
  );
  return { blob, count: games.length };
}
export {
  FileBridge,
  ImportError,
  REQUIRED,
  SAVE_DIR,
  USER_DATA_DB_NAME,
  available,
  buildZip,
  bytesNeeded,
  classifyArchives,
  clearStored,
  describeImportError,
  entryStream,
  formatBytes,
  importZips,
  isRecoverable,
  listExtra,
  listSavedGames,
  listStored,
  openZip,
  savedGamesZip,
  storeFiles
};
