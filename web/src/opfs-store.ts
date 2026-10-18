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
// The caller commits with close() or discards with abort().
export async function openStoredFile(
  parts: string[],
  known?: StoredSize,
): Promise<OpenedStoredFile> {
  const dir = (await parentDirectory(parts, true)) as FileSystemDirectoryHandle;
  const name = parts[parts.length - 1];
  if (known !== undefined) {
    const handle = await dir.getFileHandle(name, { create: true });
    return { writable: await createWritable(handle), existed: known.existed, size: known.size };
  }
  let handle: FileSystemFileHandle;
  let existed = true;
  try {
    handle = await dir.getFileHandle(name, { create: false });
  } catch (error) {
    if ((error as DOMException).name !== "NotFoundError") throw error;
    handle = await dir.getFileHandle(name, { create: true });
    existed = false;
  }
  const size = existed ? (await handle.getFile()).size : 0;
  return { writable: await createWritable(handle), existed, size };
}

// Removes a stored file; a file that is not there is already the wanted state.
export async function removeStoredFile(parts: string[]): Promise<void> {
  const dir = await parentDirectory(parts, false);
  if (dir === null) return;
  await dir.removeEntry(parts[parts.length - 1]).catch((error) => {
    if ((error as DOMException).name !== "NotFoundError") throw error;
  });
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
      const dir = await kindDirectory(entry.kind, true);
      const file = await (dir as FileSystemDirectoryHandle).getFileHandle(entry.name, { create: true });
      const stream = await createWritable(file);
      await stream.write(entry.file);
      await stream.close();
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

// Removes both the archives and the extra files (the whole zhwp tree).
export async function clearStored(): Promise<void> {
  createdParents.clear();
  const root = await navigator.storage.getDirectory();
  await root.removeEntry(ROOT_DIR, { recursive: true }).catch((error) => {
    if ((error as DOMException).name !== "NotFoundError") throw error;
  });
}
