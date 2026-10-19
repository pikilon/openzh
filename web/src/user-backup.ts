// Export and import of the player's settings and, optionally, saved games
// (owner request 2026-10-19). Everything the engine keeps lives in two IDBFS
// databases (src/user-data.ts): options and other files under the data
// directory, the settings INI under the config directory. The launcher's own
// preferences live in localStorage.
//
// Archive layout (stored ZIP, src/zip-write.ts):
//   openzh-backup.json        { format: 1, kind: "settings" | "everything", created }
//   launcher.json             launcher preferences that travel between devices
//   share/<path>              files below /home/web_user/.local/share/GeneralsX
//   config/<path>             files below /home/web_user/.config/GeneralsX
// A settings export leaves out GeneralsZH/Save/; "everything" keeps it. The
// touch controls choice is per device and never leaves it.

import { USER_DATA_DIRS } from "./user-data";
import { IDBFS_DB_VERSION, IDBFS_STORE_NAME } from "./saves";
import { buildZip, type ZipWriteEntry } from "./zip-write";
import { openZip, readSmallEntry, readSmallInflated, type ZipEntry } from "./zip";

export type BackupKind = "settings" | "everything";

const ROOTS: readonly { prefix: string; dir: string }[] = [
  { prefix: "share", dir: USER_DATA_DIRS[0] },
  { prefix: "config", dir: USER_DATA_DIRS[1] },
];
const SAVE_PATH = "/GeneralsZH/Save/";
const MANIFEST = "openzh-backup.json";
const LAUNCHER_FILE = "launcher.json";
// Launcher preferences that travel. openzh.touchControls stays on the device.
export const PORTABLE_PREFERENCE_KEYS: readonly string[] = ["openzh.muted", "openzh.performanceOverlay"];

const S_IFMT = 0o170000;
const S_IFREG = 0o100000;
const S_IFDIR = 0o040000;
const FILE_MODE = S_IFREG | 0o644;
const DIR_MODE = S_IFDIR | 0o777;

interface IdbEntry {
  timestamp?: Date | number;
  mode?: number;
  contents?: Uint8Array | ArrayBuffer;
}

export class BackupError extends Error {}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB request failed"));
  });
}

// Opens one IDBFS database the way Emscripten does, creating its store when a
// fresh profile has none yet (an import into a browser that never ran the game).
function openDb(name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(name, IDBFS_DB_VERSION);
    open.onupgradeneeded = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains(IDBFS_STORE_NAME)) {
        db.createObjectStore(IDBFS_STORE_NAME).createIndex("timestamp", "timestamp", { unique: false });
      }
    };
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error ?? new Error(`could not open ${name}`));
    open.onblocked = () => reject(new Error(`${name} is blocked`));
  });
}

function timeOf(value: Date | number | undefined): number {
  if (value instanceof Date) return value.getTime();
  return typeof value === "number" ? value : Date.now();
}

function bytesOf(contents: Uint8Array | ArrayBuffer): Uint8Array {
  return contents instanceof Uint8Array ? contents.slice() : new Uint8Array(contents.slice(0));
}

async function readRoot(prefix: string, dir: string, includeSaves: boolean): Promise<ZipWriteEntry[]> {
  const db = await openDb(dir);
  try {
    const store = db.transaction(IDBFS_STORE_NAME, "readonly").objectStore(IDBFS_STORE_NAME);
    const keys = (await request(store.getAllKeys())).map(String);
    const values = (await request(store.getAll())) as IdbEntry[];
    const entries: ZipWriteEntry[] = [];
    keys.forEach((key, i) => {
      const value = values[i];
      if (!key.startsWith(`${dir}/`)) return;
      if (typeof value.mode !== "number" || (value.mode & S_IFMT) !== S_IFREG) return;
      if (value.contents === undefined) return;
      if (!includeSaves && key.includes(SAVE_PATH)) return;
      entries.push({
        path: `${prefix}/${key.slice(dir.length + 1)}`,
        data: bytesOf(value.contents),
        mtime: timeOf(value.timestamp),
      });
    });
    return entries;
  } finally {
    db.close();
  }
}

function readPortablePreferences(): Record<string, string> {
  const values: Record<string, string> = {};
  for (const key of PORTABLE_PREFERENCE_KEYS) {
    try {
      const value = window.localStorage.getItem(key);
      if (value !== null) values[key] = value;
    } catch {
      // A blocked Storage exports no launcher preferences.
    }
  }
  return values;
}

// `flush` writes the running engine's files to IndexedDB first, so a change
// made a moment ago is in the archive.
export async function exportBackup(
  kind: BackupKind,
  flush?: () => Promise<void>,
): Promise<{ blob: Blob; files: number }> {
  if (flush !== undefined) await flush();
  const encoder = new TextEncoder();
  const files: ZipWriteEntry[] = [];
  for (const root of ROOTS) {
    files.push(...(await readRoot(root.prefix, root.dir, kind === "everything")));
  }
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const now = Date.now();
  const entries: ZipWriteEntry[] = [
    {
      path: MANIFEST,
      data: encoder.encode(JSON.stringify({ format: 1, kind, created: new Date(now).toISOString() }, null, 2)),
      mtime: now,
    },
    { path: LAUNCHER_FILE, data: encoder.encode(JSON.stringify(readPortablePreferences(), null, 2)), mtime: now },
    ...files,
  ];
  return { blob: buildZip(entries), files: files.length };
}

async function entryBytes(blob: Blob, entry: ZipEntry): Promise<Uint8Array> {
  return entry.method === 8 ? readSmallInflated(blob, entry) : readSmallEntry(blob, entry);
}

// Maps an archive path to its IDBFS key, or null for anything outside the two
// roots or with an unsafe segment.
function targetOf(path: string): string | null {
  const slash = path.indexOf("/");
  if (slash <= 0) return null;
  const root = ROOTS.find((candidate) => candidate.prefix === path.slice(0, slash));
  if (root === undefined) return null;
  const rest = path.slice(slash + 1);
  const parts = rest.split("/");
  if (rest === "" || parts.some((part) => part === "" || part === "." || part === "..")) return null;
  return `${root.dir}/${rest}`;
}

// Writes the archive's files into the engine's databases and the launcher
// preferences into localStorage. Existing files with other names are kept.
// The caller must stop the engine from flushing its own copy afterwards and
// reload the page (see suspendUserDataSaves).
export async function importBackup(file: Blob): Promise<{ files: number }> {
  let entries: ZipEntry[];
  try {
    entries = await openZip(file);
  } catch {
    throw new BackupError("This file is not a ZIP archive.");
  }
  const manifest = entries.find((entry) => entry.path === MANIFEST);
  if (manifest === undefined) throw new BackupError("This ZIP is not an OpenZH settings backup.");

  const writes = new Map<string, { key: string; data: Uint8Array }[]>();
  let launcher: Record<string, unknown> | null = null;
  for (const entry of entries) {
    if (entry.isDirectory) continue;
    if (entry.path === LAUNCHER_FILE) {
      try {
        launcher = JSON.parse(new TextDecoder().decode(await entryBytes(file, entry))) as Record<string, unknown>;
      } catch {
        launcher = null;
      }
      continue;
    }
    const key = targetOf(entry.path);
    if (key === null) continue;
    const root = ROOTS.find((candidate) => key.startsWith(`${candidate.dir}/`));
    if (root === undefined) continue;
    const list = writes.get(root.dir) ?? [];
    list.push({ key, data: await entryBytes(file, entry) });
    writes.set(root.dir, list);
  }

  let count = 0;
  const timestamp = new Date();
  for (const [dir, files] of writes) {
    const db = await openDb(dir);
    try {
      const transaction = db.transaction(IDBFS_STORE_NAME, "readwrite");
      const store = transaction.objectStore(IDBFS_STORE_NAME);
      // Every parent directory needs its own entry so the engine can recreate
      // the tree before writing the files into it.
      const dirs = new Set<string>();
      for (const { key } of files) {
        let at = key.lastIndexOf("/");
        while (at > dir.length) {
          dirs.add(key.slice(0, at));
          at = key.lastIndexOf("/", at - 1);
        }
      }
      for (const path of dirs) store.put({ timestamp, mode: DIR_MODE }, path);
      for (const { key, data } of files) store.put({ timestamp, mode: FILE_MODE, contents: data }, key);
      await new Promise<void>((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error ?? new Error("import write failed"));
        transaction.onabort = () => reject(transaction.error ?? new Error("import write aborted"));
      });
      count += files.length;
    } finally {
      db.close();
    }
  }

  if (launcher !== null) {
    for (const key of PORTABLE_PREFERENCE_KEYS) {
      const value = launcher[key];
      if (typeof value !== "string") continue;
      try {
        window.localStorage.setItem(key, value);
      } catch {
        // A blocked Storage keeps the current launcher preferences.
      }
    }
  }
  return { files: count };
}
