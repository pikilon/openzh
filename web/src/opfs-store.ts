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

export async function clearStored(): Promise<void> {
  const root = await navigator.storage.getDirectory();
  await root.removeEntry(ROOT_DIR, { recursive: true }).catch((error) => {
    if ((error as DOMException).name !== "NotFoundError") throw error;
  });
}
