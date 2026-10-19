// Reads the engine's saved games from its IDBFS database
// (docs/briefs/189-saves-survive-zips.md and 190-export-saves.md).
//
// Emscripten's IDBFS opens one IndexedDB database named after the mount point
// and keeps one FILE_DATA entry per absolute path: `{timestamp, mode,
// contents}`. Reading it directly lets the launcher list and export saves
// without starting the engine. Nothing here writes to the database.

import { buildZip } from "./zip-write";

export const USER_DATA_DB_NAME = "/home/web_user/.local/share/GeneralsX";
// GlobalData::BuildUserDataPathFromRegistry appends GeneralsX/GeneralsZH to
// XDG data home, and GameState::getSaveDirectory adds Save/.
export const SAVE_DIR = `${USER_DATA_DB_NAME}/GeneralsZH/Save`;
export const IDBFS_DB_VERSION = 21;
export const IDBFS_STORE_NAME = "FILE_DATA";

// The four top bits of a POSIX mode are the file type; directories and links
// are not saved games.
const S_IFMT = 0o170000;
const S_IFREG = 0o100000;

export interface SavedGame {
  // Relative to Save/, "/" separated.
  path: string;
  data: Uint8Array;
  // IDBFS timestamp, in milliseconds since the epoch.
  timestamp: number;
}

interface IdbFileEntry {
  timestamp?: number | Date;
  mode?: number;
  contents?: Uint8Array | ArrayBuffer;
}

function deleteDatabase(name: string): Promise<void> {
  return new Promise((resolve) => {
    let request: IDBOpenDBRequest;
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

// Opens the user-data database without starting the engine. A fresh profile
// has no database: opening with the IDBFS version creates an empty one, which
// is deleted immediately so the engine's first mount still sees a clean state.
async function openUserDataDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return null;

  let created = false;
  const request = indexedDB.open(USER_DATA_DB_NAME, IDBFS_DB_VERSION);
  request.onupgradeneeded = (event) => {
    created = event.oldVersion === 0;
    const db = request.result;
    if (!db.objectStoreNames.contains(IDBFS_STORE_NAME)) {
      const store = db.createObjectStore(IDBFS_STORE_NAME);
      store.createIndex("timestamp", "timestamp", { unique: false });
    }
  };

  const db = await new Promise<IDBDatabase>((resolve, reject) => {
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

function copyContents(contents: Uint8Array | ArrayBuffer): Uint8Array {
  if (contents instanceof Uint8Array) return contents.slice();
  return new Uint8Array(contents.slice(0));
}

// Every file below Save/, sorted by path. Missing data is zero saves.
export async function listSavedGames(): Promise<SavedGame[]> {
  const db = await openUserDataDb();
  if (db === null) return [];

  try {
    const transaction = db.transaction(IDBFS_STORE_NAME, "readonly");
    const store = transaction.objectStore(IDBFS_STORE_NAME);
    const games = await new Promise<SavedGame[]>((resolve, reject) => {
      const games: SavedGame[] = [];
      const cursorRequest = store.openCursor();
      cursorRequest.onerror = () => reject(cursorRequest.error ?? new Error("user data read failed"));
      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;
        if (cursor === null) {
          resolve(games);
          return;
        }
        const key = String(cursor.key);
        const entry = cursor.value as IdbFileEntry;
        if (
          key.startsWith(`${SAVE_DIR}/`) &&
          typeof entry.mode === "number" &&
          (entry.mode & S_IFMT) === S_IFREG &&
          entry.contents !== undefined
        ) {
          const path = key.slice(SAVE_DIR.length + 1);
          if (path.length > 0) {
            games.push({
              path,
              data: copyContents(entry.contents),
              // Emscripten stores a Date; the seeded tests use a number.
              timestamp:
                entry.timestamp instanceof Date
                  ? entry.timestamp.getTime()
                  : typeof entry.timestamp === "number"
                    ? entry.timestamp
                    : 0,
            });
          }
        }
        cursor.continue();
      };
    });

    return games.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  } finally {
    db.close();
  }
}

export interface SavedGamesArchive {
  blob: Blob;
  count: number;
}

// The engine writes its IDBFS saves back every ten seconds; `flush` is the
// page's saveUserData(module), so a just-created save is in IndexedDB before
// the archive is built. Null means there is nothing to export.
export async function savedGamesZip(
  flush?: () => Promise<void>,
): Promise<SavedGamesArchive | null> {
  if (flush !== undefined) await flush();
  const games = await listSavedGames();
  if (games.length === 0) return null;
  const blob = buildZip(
    games.map((game) => ({ path: game.path, data: game.data, mtime: game.timestamp })),
  );
  return { blob, count: games.length };
}
