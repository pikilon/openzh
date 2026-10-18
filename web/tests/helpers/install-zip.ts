// Builds a synthetic game install as a ZIP on disk for the launcher specs. The
// page only reads the archive names and copies the bytes, so each entry is a
// valid BIGF built by buildBig and no real game data is involved.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildBig } from "./big";
import { buildZip, type BuildZipEntry } from "./zip";

export interface InstallZipOptions {
  // File name inside `dir`; defaults to a unique install-<n>.zip.
  name?: string;
  // Payload written into every synthetic BIG archive.
  data?: string;
  // Exact byte size for a named archive; the BIG is padded with filler so the
  // stored entry differs in size from a previous import.
  sizes?: Readonly<Record<string, number>>;
  // Non-.big entries stored next to the archives.
  extraFiles?: readonly { path: string; data: Uint8Array | string }[];
}

const DEFAULT_DATA = "GameData\nEnd\n";
const DEFAULT_NAMES = ["INIZH.big", "W3DZH.big", "INI.big", "W3D.big"];
let sequence = 0;

function archiveBytes(name: string, options: InstallZipOptions): Uint8Array {
  const inner = `Data\\INI\\Default\\${name.replace(/\.big$/i, "")}.ini`;
  const data = options.data ?? DEFAULT_DATA;
  const base = buildBig([{ path: inner, data }]);
  const size = options.sizes?.[name];
  if (size === undefined || size === base.length) return base;
  if (size < base.length) {
    throw new Error(`install ZIP size for ${name} must be at least ${base.length} bytes`);
  }
  return buildBig([{ path: inner, data: data + "x".repeat(size - base.length) }]);
}

export async function installZip(
  dir: string,
  names: readonly string[] = DEFAULT_NAMES,
  options: InstallZipOptions = {},
): Promise<string> {
  const entries: BuildZipEntry[] = names.map((name) => ({
    path: name,
    data: archiveBytes(name, options),
    method: "store",
  }));
  for (const extra of options.extraFiles ?? []) {
    entries.push({ path: extra.path, data: extra.data, method: "store" });
  }
  const bytes = await buildZip(entries);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, options.name ?? `install-${++sequence}.zip`);
  writeFileSync(path, bytes);
  return path;
}
