// Imports the player's ZIPs into OPFS (docs/briefs/127-zip-import.md): open
// and classify every ZIP first, then stream each game archive into
// zhwp/<kind>/<name> with progress, abort and typed errors. Everything else is
// ignored: the engine reads only the `.big` archives (issue #162). Memory stays
// bounded because entries are copied chunk by chunk.

import { ImportError, type ImportErrorDetail } from "./import-error";
import { classifyArchives, type GameKind } from "./install";
import {
  openStoredFile,
  reconcileStored,
  removeStoredFile,
  type OpenedStoredFile,
  type ReconcileResult,
  type StoredSize,
} from "./opfs-store";
import {
  CRC32_INIT,
  crc32Update,
  crc32Value,
  entryDataBlob,
  openZip,
  type ZipEntry,
} from "./zip";

export interface ImportProgress {
  doneBytes: number;
  totalBytes: number;
  filesDone: number;
  filesTotal: number;
  currentFile: string;
  bytesPerSecond: number; // moving average over the last ~3 s
  etaSeconds: number | null; // null until 1 s of data exists
}

export interface ImportOptions {
  onProgress?: (progress: ImportProgress) => void;
  signal?: AbortSignal;
  // Called around the replace step: "removing" before the stored install is
  // reconciled, "importing" once it is gone and the writes may start.
  onPhase?: (phase: "removing" | "importing") => void;
}

export interface ImportResult {
  written: number;
  skipped: number; // files
  archives: { kind: GameKind; name: string; size: number }[];
  extra: number; // always 0: non-.big entries are ignored (issue #162)
  removed: number; // stored files the replace rule removed
  freedBytes: number; // their total size
}

interface ArchivePath {
  kind: GameKind;
  name: string;
}

interface PlannedFile {
  blob: Blob;
  entry: ZipEntry;
  // null when the entry is a duplicate and must not be written.
  parts: string[] | null;
}

const STORAGE_ERRORS = new Set([
  "NotAllowedError",
  "SecurityError",
  "InvalidStateError",
  "NotFoundError",
  "NoModificationAllowedError",
  "TypeMismatchError",
]);

const THROTTLE_MS = 100;
const WINDOW_MS = 3000;
const ETA_AFTER_MS = 1000;

// Stored entries are written as one blob (the browser copies it natively)
// while their CRC is read back in 1 MiB slices, which keeps the read side
// small and overlaps it with the write. Inflated entries keep bounded memory
// by coalescing decompressor chunks into one buffer before each write.
const CRC_CHUNK_SIZE = 1024 * 1024;
const INFLATE_WRITE_CHUNK = 8 * 1024 * 1024;

function now(): number {
  return performance.now();
}

function archiveOf(path: string): ArchivePath | null {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const lower = name.toLowerCase();
  if (!lower.endsWith(".big") || lower === ".big") return null;
  return { kind: lower.endsWith("zh.big") ? "zh" : "generals", name };
}

function archiveKey(archive: ArchivePath): string {
  return `${archive.kind}\u0000${archive.name.toLowerCase()}`;
}

function errorName(error: unknown): string {
  const name = (error as { name?: unknown } | null | undefined)?.name;
  return typeof name === "string" ? name : "";
}

async function freeBytes(): Promise<number | undefined> {
  try {
    const estimate = await navigator.storage.estimate();
    if (typeof estimate.quota !== "number") return undefined;
    const free = estimate.quota - (estimate.usage ?? 0);
    return Number.isFinite(free) ? free : undefined;
  } catch {
    return undefined;
  }
}

async function toImportError(
  error: unknown,
  file: string | undefined,
  needed: number,
): Promise<ImportError> {
  if (error instanceof ImportError) return error;
  const name = errorName(error);
  if (name === "AbortError") return new ImportError("aborted");
  if (name === "QuotaExceededError") {
    const detail: ImportErrorDetail = { needed };
    const free = await freeBytes();
    if (free !== undefined) detail.free = free;
    return new ImportError("quota-exceeded", detail);
  }
  const detail: ImportErrorDetail = file === undefined ? {} : { file };
  if (STORAGE_ERRORS.has(name)) return new ImportError("storage-unavailable", detail);
  return new ImportError("read-failed", detail, error);
}

function aborted(): ImportError {
  return new ImportError("aborted");
}

export async function importZips(
  zips: Blob[],
  options?: ImportOptions,
): Promise<ImportResult> {
  const signal = options?.signal;
  const onProgress = options?.onProgress;
  const onPhase = options?.onPhase;

  if (signal?.aborted) throw aborted();

  // Before writing anything, open and classify every ZIP.
  const opened: { blob: Blob; entries: ZipEntry[] }[] = [];
  const paths: string[] = [];
  for (const blob of zips) {
    let entries: ZipEntry[];
    try {
      entries = await openZip(blob);
    } catch (error) {
      const file = blob instanceof File ? blob.name : undefined;
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
  const archiveSizes = new Map<string, number>();
  const seenArchives = new Set<string>();
  const plan: PlannedFile[] = [];

  for (const source of opened) {
    for (const entry of source.entries) {
      if (entry.isDirectory) continue;
      // Everything that is not a game archive is ignored: the engine reads
      // nothing else (issue #162).
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
        parts: first ? [archive.kind, archive.name] : null,
      });
    }
  }

  const archives = report.archives.map((archive) => {
    const key = archiveKey(archive);
    return { kind: archive.kind, name: archive.name, size: archiveSizes.get(key) ?? 0 };
  });

  // Every file the new install will contain, after the first-duplicate rule.
  // Nothing is written until the stored files that are not in this set (or
  // whose size differs) are gone.
  const incoming = new Map<string, number>();
  for (const file of plan) {
    if (file.parts === null) continue;
    const key = file.parts.join("/");
    if (!incoming.has(key)) incoming.set(key, file.entry.size);
  }

  onPhase?.("removing");
  let reconciled: ReconcileResult;
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
  let committedBytes = 0; // bytes of files that are fully written or skipped
  let filesDone = 0;
  let written = 0;
  let skipped = 0;
  const startedAt = now();
  let lastEmitAt = Number.NEGATIVE_INFINITY;
  const samples: { at: number; bytes: number }[] = [];

  const emit = (currentFile: string, force: boolean): void => {
    const at = now();
    if (!force && at - lastEmitAt < THROTTLE_MS) return;
    lastEmitAt = at;
    samples.push({ at, bytes: doneBytes });
    while (samples.length > 2 && at - samples[0].at > WINDOW_MS) samples.shift();
    const first = samples[0];
    const seconds = (at - first.at) / 1000;
    const measured = seconds > 0 ? (doneBytes - first.bytes) / seconds : 0;
    const bytesPerSecond = Number.isFinite(measured) && measured > 0 ? measured : 0;
    let etaSeconds: number | null = null;
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
      etaSeconds,
    });
  };

  emit(plan.length === 0 ? "" : plan[0].entry.path, true);

  // The files the replace rule kept. Every path is written at most once per
  // import (later duplicates are skipped), so this snapshot stays valid for the
  // whole run.
  const known = reconciled.remaining;
  if (signal?.aborted) throw aborted();
  const knownOf = (parts: string[]): StoredSize =>
    known.get(parts.join("/")) ?? { existed: false, size: 0 };

  const addBytes = (file: PlannedFile, count: number): void => {
    doneBytes += count;
    emit(file.entry.path, false);
  };

  const countSkipped = (file: PlannedFile): void => {
    doneBytes += file.entry.size;
    committedBytes += file.entry.size;
    filesDone++;
    skipped++;
    emit(file.entry.path, true);
  };

  const countWritten = (file: PlannedFile): void => {
    committedBytes += file.entry.size;
    filesDone++;
    written++;
    emit(file.entry.path, true);
  };

  const discard = async (target: OpenedStoredFile, parts: string[]): Promise<void> => {
    await target.abort();
    if (!target.existed) await removeStoredFile(parts).catch(() => undefined);
  };

  // Stored entries: one blob write (the browser copies it natively), with
  // the CRC read in 1 MiB slices behind it. The write is returned in flight
  // so several entries can be written at once; the CRC runs later, in plan
  // order, so a slow blob (the tests' SlowBlob) still paces the import.
  const dispatchStored = async (
    file: PlannedFile,
    target: OpenedStoredFile,
  ): Promise<PreparedFile> => {
    const data = await entryDataBlob(file.blob, file.entry);
    if (signal?.aborted) throw aborted();
    let writing: Promise<void> | null = null;
    if (data.size > 0) {
      writing = target.writable.write(data);
      writing.catch(() => undefined);
    }
    return { file, target, writing, data, verified: false };
  };

  const verifyStored = async (
    prepared: PreparedFile,
    ignoreAbort = false,
  ): Promise<void> => {
    if (prepared.data === null || prepared.verified) return;
    const data = prepared.data;
    let crc = CRC32_INIT;
    let total = 0;
    let pending: Promise<ArrayBuffer> | null =
      data.size > 0 ? data.slice(0, Math.min(CRC_CHUNK_SIZE, data.size)).arrayBuffer() : null;
    pending?.catch(() => undefined);
    for (let at = 0; at < data.size; ) {
      if (!ignoreAbort && signal?.aborted) throw aborted();
      const bytes = new Uint8Array(await (pending as Promise<ArrayBuffer>));
      const next = at + CRC_CHUNK_SIZE;
      pending =
        next < data.size
          ? data.slice(next, Math.min(next + CRC_CHUNK_SIZE, data.size)).arrayBuffer()
          : null;
      pending?.catch(() => undefined);
      crc = crc32Update(crc, bytes);
      total += bytes.length;
      at = next;
      addBytes(prepared.file, bytes.length);
    }
    if (
      total !== prepared.file.entry.size ||
      crc32Value(crc) !== prepared.file.entry.crc32
    ) {
      throw new ImportError("bad-crc", { file: prepared.file.entry.path });
    }
    prepared.verified = true;
  };

  // Inflates straight from the entry's compressed blob, verifies size and CRC
  // while reading, and coalesces ~8 MiB before each write so the OPFS write
  // side is not one tiny call per decompressor chunk.
  const writeInflatedData = async (
    file: PlannedFile,
    target: OpenedStoredFile,
  ): Promise<void> => {
    const compressed = await entryDataBlob(file.blob, file.entry);
    const reader = compressed
      .stream()
      .pipeThrough(new DecompressionStream("deflate-raw"))
      .getReader();
    const bufferSize = Math.min(INFLATE_WRITE_CHUNK, Math.max(file.entry.size, 1));
    let buffer = new Uint8Array(bufferSize);
    let used = 0;
    let crc = CRC32_INIT;
    let total = 0;
    let writing: Promise<void> | null = null;
    const flush = async (): Promise<void> => {
      if (used === 0) return;
      const out = buffer.subarray(0, used);
      buffer = new Uint8Array(bufferSize);
      used = 0;
      const previous = writing;
      const write = target.writable.write(out);
      write.catch(() => undefined);
      writing = write;
      if (previous !== null) await previous;
    };
    try {
      for (;;) {
        if (signal?.aborted) throw aborted();
        let chunk: ReadableStreamReadResult<Uint8Array>;
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
      reader.cancel().catch(() => undefined);
      if (writing !== null) await writing.catch(() => undefined);
      throw error;
    }
  };

  interface PreparedFile {
    file: PlannedFile;
    target: OpenedStoredFile | null; // null: duplicate or already stored
    writing: Promise<void> | null; // in flight after dispatch
    data: Blob | null; // stored entries only: raw bytes for the CRC pass
    verified: boolean;
  }

  const abortPrepared = async (prepared: PreparedFile): Promise<void> => {
    if (prepared.target !== null) {
      await discard(prepared.target, prepared.file.parts as string[]);
    }
    if (prepared.writing !== null) await prepared.writing.catch(() => undefined);
  };

  // Dispatch every archive write, then verify the stored CRCs in plan order
  // (concurrently writing while reading back), then let the caller commit. A
  // failure keeps the files before it and discards the rest, exactly like the
  // old one-at-a-time loop.
  const dispatchLarge = async (file: PlannedFile): Promise<PreparedFile> => {
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

  interface LargeGroup {
    pending: PreparedFile[];
    failure: unknown;
    failedAt: number; // index of the first file that must not be committed
  }

  const dispatchLargeGroup = async (files: PlannedFile[]): Promise<LargeGroup> => {
    const pending: PreparedFile[] = [];
    let failure: unknown = null;
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
        // Aborted while this file's write was starting: that file is the
        // first one not to keep, everything before it still finishes.
        failure = aborted();
        failedAt = pending.length - 1;
        break;
      }
    }
    return { pending, failure, failedAt };
  };

  const verifyLargeGroup = async (
    pending: PreparedFile[],
  ): Promise<{ failure: unknown; failedAt: number }> => {
    for (let index = 0; index < pending.length; index++) {
      try {
        await verifyStored(pending[index]);
      } catch (error) {
        return { failure: error, failedAt: index };
      }
    }
    return { failure: null, failedAt: pending.length };
  };

  const commitPrepared = async (prepared: PreparedFile): Promise<void> => {
    const { file, target, writing } = prepared;
    if (target === null) {
      countSkipped(file);
      return;
    }
    try {
      if (writing !== null) await writing;
      await target.commit();
    } catch (error) {
      await discard(target, file.parts as string[]);
      throw await toImportError(error, file.entry.path, totalBytes - committedBytes);
    }
    countWritten(file);
  };

  const abortRemaining = async (pending: PreparedFile[], from: number): Promise<void> => {
    for (let index = from; index < pending.length; index++) {
      await abortPrepared(pending[index]);
    }
  };

  // Finishes a group that failed part way: commit the entries before the
  // failure, discard the failed one and everything after it.
  const finishLargeFailure = async (group: LargeGroup): Promise<void> => {
    for (let index = 0; index < group.failedAt; index++) {
      const prepared = group.pending[index];
      try {
        // These were dispatched before the failure; finish them even if the
        // failure was an abort, which is what the old in-order loop did.
        await verifyStored(prepared, true);
        await commitPrepared(prepared);
      } catch (error) {
        await abortRemaining(group.pending, index);
        throw error;
      }
    }
    await abortRemaining(group.pending, group.failedAt);
  };

  // Every planned file is a game archive: dispatch all writes, verify the
  // stored CRCs in plan order (concurrently writing while reading back), then
  // commit them. A failure keeps the files before it and discards the rest.
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
      failedAt: verified.failedAt,
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
    // Entry sizes and streamed bytes disagree: a file was not read to the end.
    throw new ImportError("read-failed", { file: plan[plan.length - 1].entry.path });
  }
  emit(plan.length === 0 ? "" : plan[plan.length - 1].entry.path, true);

  return {
    written,
    skipped,
    archives,
    extra: 0,
    removed: reconciled.removed,
    freedBytes: reconciled.freedBytes,
  };
}
