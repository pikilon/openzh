// Imports the player's ZIPs into OPFS (docs/briefs/127-zip-import.md): open
// and classify every ZIP first, then stream each entry into
// zhwp/<kind>/<name> for the game archives and zhwp/extra/<path> for
// everything else, with progress, abort and typed errors. Memory stays
// bounded because entries are copied chunk by chunk.

import { ImportError, type ImportErrorDetail } from "./import-error";
import { classifyArchives, type GameKind } from "./install";
import { openStoredFile, removeStoredFile, storedFileSize } from "./opfs-store";
import { entryStream, openZip, type ZipEntry } from "./zip";

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
}

export interface ImportResult {
  written: number;
  skipped: number; // files, extra files included
  archives: { kind: GameKind; name: string; size: number }[];
  extra: number; // non-.big files in `written + skipped`
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
  isExtra: boolean;
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

function extraParts(path: string): string[] {
  return ["extra", ...path.split("/").filter((segment) => segment !== "")];
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
  const seenExtras = new Set<string>();
  const plan: PlannedFile[] = [];

  for (const source of opened) {
    for (const entry of source.entries) {
      if (entry.isDirectory) continue;
      const archive = archiveOf(entry.path);
      if (archive !== null) {
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
          isExtra: false,
        });
        continue;
      }
      const firstExtra = !seenExtras.has(entry.path);
      if (firstExtra) seenExtras.add(entry.path);
      plan.push({
        blob: source.blob,
        entry,
        parts: firstExtra ? extraParts(entry.path) : null,
        isExtra: true,
      });
    }
  }

  const archives = report.archives.map((archive) => {
    const key = archiveKey(archive);
    return { kind: archive.kind, name: archive.name, size: archiveSizes.get(key) ?? 0 };
  });

  const totalBytes = plan.reduce((sum, file) => sum + file.entry.size, 0);
  const filesTotal = plan.length;
  let doneBytes = 0;
  let committedBytes = 0; // bytes of files that are fully written or skipped
  let filesDone = 0;
  let written = 0;
  let skipped = 0;
  let extra = 0;
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

  for (const file of plan) {
    if (signal?.aborted) throw aborted();
    const currentFile = file.entry.path;

    if (file.parts === null) {
      // Duplicate path: the first copy already won, count this one as done.
      doneBytes += file.entry.size;
      committedBytes = doneBytes;
      filesDone++;
      skipped++;
      if (file.isExtra) extra++;
      emit(currentFile, true);
      continue;
    }

    const existing = await storedFileSize(file.parts);
    if (existing === file.entry.size) {
      doneBytes += file.entry.size;
      committedBytes = doneBytes;
      filesDone++;
      skipped++;
      if (file.isExtra) extra++;
      emit(currentFile, true);
      continue;
    }

    const target = await openStoredFile(file.parts);
    if (target.existed && target.size === file.entry.size) {
      await target.writable.abort();
      doneBytes += file.entry.size;
      committedBytes = doneBytes;
      filesDone++;
      skipped++;
      if (file.isExtra) extra++;
      emit(currentFile, true);
      continue;
    }

    let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
    try {
      reader = entryStream(file.blob, file.entry).getReader();
      for (;;) {
        if (signal?.aborted) throw aborted();
        const chunk = await reader.read();
        if (chunk.done) break;
        if (signal?.aborted) throw aborted();
        await target.writable.write(chunk.value);
        doneBytes += chunk.value.length;
        emit(currentFile, false);
      }
      await target.writable.close();
    } catch (error) {
      const active = reader;
      reader = null;
      if (active !== null) await active.cancel().catch(() => undefined);
      // Aborting the writable discards the temp file; an old version stays.
      await target.writable.abort().catch(() => undefined);
      if (!target.existed) await removeStoredFile(file.parts).catch(() => undefined);
      throw await toImportError(error, currentFile, totalBytes - committedBytes);
    } finally {
      reader = null;
    }

    committedBytes = doneBytes;
    filesDone++;
    written++;
    if (file.isExtra) extra++;
    emit(currentFile, true);
  }

  if (doneBytes !== totalBytes) {
    // Entry sizes and streamed bytes disagree: a file was not read to the end.
    throw new ImportError("read-failed", { file: plan[plan.length - 1].entry.path });
  }
  emit(plan.length === 0 ? "" : plan[plan.length - 1].entry.path, true);

  return { written, skipped, archives, extra };
}
