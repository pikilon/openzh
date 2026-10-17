// Persists the engine's user data across reloads (docs/briefs/19-persist-user-data.md).
//
// In the browser HOME is /home/web_user, so the engine keeps options and saved
// games under /home/web_user/.local/share/GeneralsX and its settings INI under
// /home/web_user/.config/GeneralsX. Both directories are mounted as Emscripten
// IDBFS and loaded from IndexedDB before the engine starts (a held run
// dependency) and flushed back there every SAVE_INTERVAL_MS and on pagehide.

export const USER_DATA_DIRS: readonly string[] = [
  "/home/web_user/.local/share/GeneralsX",
  "/home/web_user/.config/GeneralsX",
];

const RUN_DEPENDENCY = "zhwp-user-data";
const SAVE_INTERVAL_MS = 10_000;

// Emscripten's errno for "already exists"; the directories are created with
// parents, so an existing one is not an error.
const EEXIST = 20;

function ensureDir(FS: any, dir: string): void {
  const parts = dir.split("/").filter((part) => part.length > 0);
  let path = "";
  for (const part of parts) {
    path += `/${part}`;
    try {
      FS.mkdir(path);
    } catch (error) {
      // The user data roots (/home/web_user/...) may already exist; anything
      // else that cannot be created surfaces when the mount below fails.
      if ((error as { errno?: number }).errno !== EEXIST) throw error;
    }
  }
}

function mountUserData(module: any): void {
  const { FS, IDBFS } = module;
  for (const dir of USER_DATA_DIRS) {
    ensureDir(FS, dir);
    FS.mount(IDBFS, {}, dir);
  }
  // One populate covers every IDBFS mount, and it releases the single run
  // dependency taken in preRun exactly once.
  FS.syncfs(true, (error: unknown | null) => {
    if (error) {
      // A load failure never blocks start-up: the engine runs with empty data.
      console.warn("[user-data] load failed:", error);
    }
    module.removeRunDependency(RUN_DEPENDENCY);
  });
}

// A save in flight is coalesced so the periodic and pagehide flushes never
// overlap; each caller resolves with the flush that carries its changes.
let pending: Promise<void> | null = null;

function syncToIDB(module: any): Promise<void> {
  return new Promise((resolve, reject) => {
    module.FS.syncfs(false, (error: unknown | null) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function save(module: any): Promise<void> {
  if (pending === null) {
    pending = syncToIDB(module).finally(() => {
      pending = null;
    });
  }
  return pending;
}

// Whether the periodic/pagehide save loop has been armed for this module.
const armed = new WeakSet<object>();

function armSaves(module: any): void {
  if (armed.has(module)) return;
  armed.add(module);
  setInterval(() => {
    void save(module).catch((error) =>
      console.warn("[user-data] save failed:", error),
    );
  }, SAVE_INTERVAL_MS);
  window.addEventListener("pagehide", () => {
    void save(module).catch((error) =>
      console.warn("[user-data] save failed:", error),
    );
  });
}

export function addUserDataPersistence<T extends object>(
  options: T,
): T & { preRun: ((m: any) => void)[] } {
  const source = options as T & {
    preRun?: ((module: any) => void)[] | ((module: any) => void);
  };
  const existing = source.preRun ?? [];
  const preRun = typeof existing === "function" ? [existing] : [...existing];
  preRun.push((module: any) => {
    module.addRunDependency(RUN_DEPENDENCY);
    mountUserData(module);
    armSaves(module);
  });
  return { ...source, preRun };
}

export function saveUserData(module: any): Promise<void> {
  return save(module);
}
