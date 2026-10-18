// Stores the player's picked game archives in OPFS, one directory per kind
// (docs/decisions.md, D-03): OPFS root -> zhwp -> <kind> -> <name>.

import type { GameKind } from "./install";

export interface StoredFile {
  kind: GameKind;
  name: string;
  size: number;
}

const ROOT_DIR = "zhwp";
const KINDS: GameKind[] = ["zh", "generals"];

// Overwrites an existing file, which is what the (re)write path needs.
async function createWritable(
  file: FileSystemFileHandle,
): Promise<FileSystemWritableFileStream> {
  const create = (
    file as FileSystemFileHandle & {
      createWritable(options?: { keepExistingData?: boolean }): Promise<FileSystemWritableFileStream>;
    }
  ).createWritable;
  return create.call(file, { keepExistingData: false });
}

async function kindDirectory(kind: GameKind, create: boolean): Promise<FileSystemDirectoryHandle | null> {
  const root = await navigator.storage.getDirectory();
  let parent: FileSystemDirectoryHandle;
  try {
    parent = await root.getDirectoryHandle(ROOT_DIR, { create });
  } catch (error) {
    if (!create && (error as DOMException).name === "NotFoundError") return null;
    throw error;
  }
  try {
    return await parent.getDirectoryHandle(kind, { create });
  } catch (error) {
    if (!create && (error as DOMException).name === "NotFoundError") return null;
    throw error;
  }
}

const EXTRA_DIR = "extra";

// Incomplete files stay outside zhwp, under their final basename, and are
// moved into place only once they are complete (issue #129). A reload in the
// middle of an import therefore leaves nothing under zhwp that listStored
// could mistake for a stored archive.
const STAGING_DIR = "zhwp.tmp";

// Root of everything the wrapper owns. Missing on a fresh profile.
async function rootDirectory(create: boolean): Promise<FileSystemDirectoryHandle | null> {
  const root = await navigator.storage.getDirectory();
  try {
    return await root.getDirectoryHandle(ROOT_DIR, { create });
  } catch (error) {
    if (!create && (error as DOMException).name === "NotFoundError") return null;
    throw error;
  }
}

// Directory that holds the last segment of `parts` (relative to zhwp).
async function createParentDirectory(parts: string[]): Promise<FileSystemDirectoryHandle> {
  let dir = await rootDirectory(true);
  for (const segment of parts.slice(0, -1)) {
    dir = await dir.getDirectoryHandle(segment, { create: true });
  }
  return dir;
}

// Creating the same directory for every file is pure overhead during a large
// import, so the create path keeps one promise per parent. clearStored drops
// them: after the tree is removed the handles are stale.
const createdParents = new Map<string, Promise<FileSystemDirectoryHandle>>();

async function parentDirectory(
  parts: string[],
  create: boolean,
): Promise<FileSystemDirectoryHandle | null> {
  if (!create) {
    let dir = await rootDirectory(false);
    if (dir === null) return null;
    for (const segment of parts.slice(0, -1)) {
      try {
        dir = await dir.getDirectoryHandle(segment, { create: false });
      } catch (error) {
        if ((error as DOMException).name === "NotFoundError") return null;
        throw error;
      }
    }
    return dir;
  }
  const key = parts.slice(0, -1).join("\u0000");
  let pending = createdParents.get(key);
  if (pending === undefined) {
    pending = createParentDirectory(parts);
    createdParents.set(key, pending);
    pending.catch(() => {
      if (createdParents.get(key) === pending) createdParents.delete(key);
    });
  }
  return pending;
}

// Same caching as the final parents, for the staging tree under zhwp.tmp.
const stagingParents = new Map<string, Promise<FileSystemDirectoryHandle>>();

async function stagingDirectory(parts: string[]): Promise<FileSystemDirectoryHandle> {
  const key = parts.slice(0, -1).join("\u0000");
  let pending = stagingParents.get(key);
  if (pending === undefined) {
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

// Size of an already stored file, or null when it is not there yet.
export async function storedFileSize(parts: string[]): Promise<number | null> {
  const dir = await parentDirectory(parts, false);
  if (dir === null) return null;
  try {
    const handle = await dir.getFileHandle(parts[parts.length - 1], { create: false });
    return (await handle.getFile()).size;
  } catch (error) {
    if ((error as DOMException).name === "NotFoundError") return null;
    throw error;
  }
}

export interface OpenedStoredFile {
  writable: FileSystemWritableFileStream;
  existed: boolean;
  size: number;
  // Closes the staging file and moves it to its final name, or discards it.
  commit(): Promise<void>;
  abort(): Promise<void>;
}

export interface StoredSize {
  existed: boolean;
  size: number;
}

// One walk of zhwp gives every stored path and its size, so a big import can
// decide "already stored" without a failed getFileHandle per file.
export async function storedSnapshot(): Promise<Map<string, StoredSize>> {
  const sizes = new Map<string, StoredSize>();
  const root = await rootDirectory(false);
  if (root === null) return sizes;
  const walk = async (dir: FileSystemDirectoryHandle, prefix: string): Promise<void> => {
    for await (const [name, handle] of dir.entries()) {
      const path = prefix === "" ? name : `${prefix}/${name}`;
      if (handle.kind === "directory") {
        await walk(handle as FileSystemDirectoryHandle, path);
      } else {
        const file = await (handle as FileSystemFileHandle).getFile();
        sizes.set(path, { existed: true, size: file.size });
      }
    }
  };
  await walk(root, "");
  return sizes;
}

// Opens a file under zhwp/<parts> for writing, creating parent directories.
// The bytes go to zhwp.tmp/<parts> and only commit() publishes them at the
// final name, so an interrupted write is never visible as a stored archive.
export async function openStoredFile(
  parts: string[],
  known?: StoredSize,
): Promise<OpenedStoredFile> {
  const dir = (await parentDirectory(parts, true)) as FileSystemDirectoryHandle;
  const name = parts[parts.length - 1];
  let existed: boolean;
  let size: number;
  if (known !== undefined) {
    existed = known.existed;
    size = known.size;
  } else {
    try {
      const handle = await dir.getFileHandle(name, { create: false });
      existed = true;
      size = (await handle.getFile()).size;
    } catch (error) {
      if ((error as DOMException).name !== "NotFoundError") throw error;
      existed = false;
      size = 0;
    }
  }
  const stagingDir = await stagingDirectory(parts);
  const staging = await stagingDir.getFileHandle(name, { create: true });
  let writable: FileSystemWritableFileStream;
  try {
    writable = await createWritable(staging);
  } catch (error) {
    await stagingDir.removeEntry(name).catch(() => undefined);
    throw error;
  }
  const commit = async (): Promise<void> => {
    await writable.close();
    const move = (
      staging as FileSystemFileHandle & {
        move?: (parent: FileSystemDirectoryHandle, name: string) => Promise<void>;
      }
    ).move;
    if (typeof move === "function") {
      // One atomic rename: the final name appears complete or not at all.
      await move.call(staging, dir, name);
      return;
    }
    // Browsers without the experimental move() copy the finished bytes in one
    // write. The final name only exists while that copy runs.
    const data = await staging.getFile();
    const final = await dir.getFileHandle(name, { create: true });
    const stream = await createWritable(final);
    try {
      await stream.write(data);
      await stream.close();
    } catch (error) {
      await stream.abort().catch(() => undefined);
      throw error;
    }
    await stagingDir.removeEntry(name).catch(() => undefined);
  };
  const abort = async (): Promise<void> => {
    await writable.abort().catch(() => undefined);
    await stagingDir.removeEntry(name).catch(() => undefined);
  };
  return { writable, existed, size, commit, abort };
}

// Removes a stored file; a file that is not there is already the wanted state.
export async function removeStoredFile(parts: string[]): Promise<void> {
  const dir = await parentDirectory(parts, false);
  if (dir === null) return;
  await dir.removeEntry(parts[parts.length - 1]).catch((error) => {
    if ((error as DOMException).name !== "NotFoundError") throw error;
  });
}

function abortError(): DOMException {
  return new DOMException("The import was aborted", "AbortError");
}

async function removeEmptyDirectories(
  dir: FileSystemDirectoryHandle,
  signal: AbortSignal | undefined,
): Promise<void> {
  const children: [string, FileSystemDirectoryHandle][] = [];
  for await (const [name, handle] of dir.entries()) {
    if (handle.kind === "directory") {
      children.push([name, handle as FileSystemDirectoryHandle]);
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

export interface ReconcileResult {
  removed: number;
  freedBytes: number;
  // Every file still stored afterwards, with the size the write loop compares.
  remaining: Map<string, StoredSize>;
}

// Replaces the stored install with the incoming one (issue #157): a stored file
// stays only when the incoming set has the same path and size, and every other
// file is removed before the import writes anything. Directories left empty
// under extra/ go too. Throws a DOMException AbortError when `signal` aborts
// during the removal; every other failure is left to the caller.
export async function reconcileStored(
  keep: ReadonlyMap<string, number>,
  signal?: AbortSignal,
): Promise<ReconcileResult> {
  if (signal?.aborted) throw abortError();
  const snapshot = await storedSnapshot();
  if (signal?.aborted) throw abortError();
  const remaining = new Map<string, StoredSize>();
  let removed = 0;
  let freedBytes = 0;
  for (const [path, known] of snapshot) {
    const underInstall =
      KINDS.some((kind) => path.startsWith(`${kind}/`)) ||
      path.startsWith(`${EXTRA_DIR}/`);
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
    // A cached parent handle for a directory removed here would create files
    // in the old, detached directory.
    createdParents.clear();
    const root = await rootDirectory(false);
    if (root !== null) {
      try {
        const extra = await root.getDirectoryHandle(EXTRA_DIR, { create: false });
        await removeEmptyDirectories(extra, signal);
      } catch (error) {
        if ((error as DOMException).name !== "NotFoundError") throw error;
      }
    }
  }
  return { removed, freedBytes, remaining };
}

async function findFile(
  kind: GameKind,
  name: string,
): Promise<FileSystemFileHandle | null> {
  const dir = await kindDirectory(kind, false);
  if (dir === null) return null;
  try {
    return await dir.getFileHandle(name, { create: false });
  } catch (error) {
    if ((error as DOMException).name === "NotFoundError") return null;
    throw error;
  }
}

export async function storeFiles(
  entries: { kind: GameKind; name: string; file: Blob }[],
  onProgress?: (doneBytes: number, totalBytes: number) => void,
): Promise<{ written: number; skipped: number }> {
  const total = entries.reduce((sum, entry) => sum + entry.file.size, 0);
  let done = 0;
  let written = 0;
  let skipped = 0;
  for (const entry of entries) {
    const existing = await findFile(entry.kind, entry.name);
    if (existing !== null && (await existing.getFile()).size === entry.file.size) {
      // Same size already stored: skip the copy, but count it as done.
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

export async function listStored(): Promise<StoredFile[]> {
  const stored: StoredFile[] = [];
  for (const kind of KINDS) {
    const dir = await kindDirectory(kind, false);
    if (dir === null) continue;
    for await (const [name, handle] of dir.entries()) {
      if (handle.kind !== "file") continue;
      const size = await (handle as FileSystemFileHandle).getFile().then((f) => f.size);
      stored.push({ kind, name, size });
    }
  }
  stored.sort(
    (a, b) => KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind) || a.name.localeCompare(b.name),
  );
  return stored;
}

export interface ExtraFile {
  path: string; // relative to zhwp/extra, "/" separated
  size: number;
}

async function walkExtra(
  dir: FileSystemDirectoryHandle,
  prefix: string,
  files: ExtraFile[],
): Promise<void> {
  for await (const [name, handle] of dir.entries()) {
    const path = prefix === "" ? name : `${prefix}/${name}`;
    if (handle.kind === "directory") {
      await walkExtra(handle as FileSystemDirectoryHandle, path, files);
    } else {
      const size = await (handle as FileSystemFileHandle).getFile().then((f) => f.size);
      files.push({ path, size });
    }
  }
}

export async function listExtra(): Promise<ExtraFile[]> {
  const root = await rootDirectory(false);
  if (root === null) return [];
  let extra: FileSystemDirectoryHandle;
  try {
    extra = await root.getDirectoryHandle(EXTRA_DIR, { create: false });
  } catch (error) {
    if ((error as DOMException).name === "NotFoundError") return [];
    throw error;
  }
  const files: ExtraFile[] = [];
  await walkExtra(extra, "", files);
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return files;
}

// Issue #162: the import stores only the game archives, so an `extra/` tree
// left by an older version is dead weight. It is removed once at launcher
// start, before the stored summary; cleanup must never block the page, so
// every failure is ignored.
export async function removeExtra(): Promise<void> {
  try {
    const root = await navigator.storage.getDirectory();
    await root.removeEntry(EXTRA_DIR, { recursive: true });
  } catch {
    // Already gone, or storage is unavailable: the import reports that.
  }
}

// Removes both the archives and the extra files (the whole zhwp tree), plus
// any incomplete files left in the staging tree by an interrupted import.
export async function clearStored(): Promise<void> {
  createdParents.clear();
  stagingParents.clear();
  const root = await navigator.storage.getDirectory();
  for (const name of [ROOT_DIR, STAGING_DIR]) {
    await root.removeEntry(name, { recursive: true }).catch((error) => {
      if ((error as DOMException).name !== "NotFoundError") throw error;
    });
  }
}
