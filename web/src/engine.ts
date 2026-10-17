// Factory options for the engine build (docs/decisions.md, D-03): the stored
// archives are mounted into the engine's file system before it runs, at the
// paths the engine expects (/GeneralsZH and /Generals, see
// GeneralsMD/Code/Main/SDL3Main.cpp).

import type { StoredFile } from "./opfs-store";
import { listStored } from "./opfs-store";
import { FileBridge } from "./bridge";
import { mountArchives } from "./mount";

type Options = {
  preRun?: ((module: any) => void)[] | ((module: any) => void);
};

export async function prepareEngineOptions<T extends object>(
  options: T,
): Promise<T & { preRun: ((m: any) => void)[] }> {
  const files: StoredFile[] = await listStored();
  const bridge = files.length > 0 ? await FileBridge.start(files) : undefined;
  const source = options as T & Options;
  const existing = source.preRun ?? [];
  const preRun = typeof existing === "function" ? [existing] : [...existing];
  preRun.push((module: any) => {
    if (bridge !== undefined) mountArchives(module.FS, bridge, files);
  });
  return { ...source, preRun };
}
