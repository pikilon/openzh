// Classifies the game archives the player picked (docs/decisions.md, D-03).
// Pure logic: no DOM, runs in Node and in the browser.

export type GameKind = "zh" | "generals";

export interface ArchiveEntry {
  kind: GameKind;
  name: string;
  path: string;
}

export interface InstallReport {
  archives: ArchiveEntry[];
  missing: string[];
}

export const REQUIRED: { zh: readonly string[]; generals: readonly string[] } = {
  zh: ["INIZH.big", "W3DZH.big"],
  generals: ["INI.big", "W3D.big"],
};

const KIND_ORDER: Record<GameKind, number> = { zh: 0, generals: 1 };

// Lower-cased basenames the engine cannot run without, per kind.
function requiredKeys(kind: GameKind): string[] {
  return REQUIRED[kind].map((name) => name.toLowerCase());
}

export function classifyArchives(paths: string[]): InstallReport {
  const archives: ArchiveEntry[] = [];
  // Duplicates (same kind, same lower-cased name): the first in input order wins.
  const seen = new Set<string>();
  for (const path of paths) {
    // The basename is the part after the last separator, exactly as given.
    const name = path.slice(path.lastIndexOf("/") + 1);
    const lower = name.toLowerCase();
    // Only basenames ending in ".big" with a non-empty stem count.
    if (!lower.endsWith(".big") || lower === ".big") continue;
    const kind: GameKind = lower.endsWith("zh.big") ? "zh" : "generals";
    const key = `${kind}\u0000${lower}`;
    if (seen.has(key)) continue;
    seen.add(key);
    archives.push({ kind, name, path });
  }
  archives.sort(
    (a, b) =>
      KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
      a.name.toLowerCase().localeCompare(b.name.toLowerCase()),
  );
  const missing: string[] = [];
  const byName = new Set(archives.map((entry) => entry.name.toLowerCase()));
  for (const kind of ["zh", "generals"] as const) {
    for (let i = 0; i < REQUIRED[kind].length; i++) {
      if (!byName.has(requiredKeys(kind)[i])) missing.push(REQUIRED[kind][i]);
    }
  }
  return { archives, missing };
}
