// Puts files into the engine's user data before it starts
// (docs/briefs/39-replay-file.md). A replay is read from Replays/ under
// USER_DATA_DIRS[0], so a harness supplies it here instead of uploading it.

import { USER_DATA_DIRS } from "./user-data";

export interface UserFile {
  path: string;
  data: Uint8Array;
}

const RUN_DEPENDENCY = "zhwp-user-files";

// The path is relative to the user data root: an empty path, an absolute one
// or one with empty, "." or ".." segments could escape it.
function validate(path: string): void {
  const segments = path.split("/");
  if (
    path.length === 0 ||
    path.startsWith("/") ||
    segments.some(
      (segment) => segment === "" || segment === "." || segment === "..",
    )
  ) {
    throw new Error(`invalid user file path: ${JSON.stringify(path)}`);
  }
}

function writeFile(module: any, file: UserFile): void {
  const fullPath = `${USER_DATA_DIRS[0]}/${file.path}`;
  module.FS.mkdirTree(fullPath.slice(0, fullPath.lastIndexOf("/")));
  module.FS.writeFile(fullPath, file.data);
}

export function addUserFiles<T extends object>(
  options: T,
  files: UserFile[],
): T & { preRun: ((m: any) => void)[] } {
  for (const file of files) validate(file.path);
  const source = options as T & {
    preRun?: ((module: any) => void)[] | ((module: any) => void);
  };
  const existing = source.preRun ?? [];
  const preRun = typeof existing === "function" ? [existing] : [...existing];
  preRun.push((module: any) => {
    const writeAll = () => {
      for (const file of files) writeFile(module, file);
    };
    // prepareEngineOptions loads the user data through IDBFS in a preRun that
    // runs before this one. FS.syncfs(true, ...) reconciles the folder with
    // IndexedDB, which would remove files written now. Wait for that load to
    // release its run dependency instead; main cannot start until the
    // dependency taken here is released too.
    if (module.FS.syncFSRequests === 0) {
      writeAll();
      return;
    }
    const removeRunDependency = module.removeRunDependency;
    module.addRunDependency(RUN_DEPENDENCY);
    module.removeRunDependency = (id: string) => {
      if (module.FS.syncFSRequests > 0) {
        removeRunDependency.call(module, id);
        return;
      }
      // The load is done: write after it has populated the folder and before
      // main, keeping its files and replacing any under the same path.
      module.removeRunDependency = removeRunDependency;
      try {
        writeAll();
      } finally {
        removeRunDependency.call(module, id);
        removeRunDependency.call(module, RUN_DEPENDENCY);
      }
    };
  });
  return { ...source, preRun };
}
