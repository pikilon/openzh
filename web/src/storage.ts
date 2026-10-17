// Storage helpers for the launcher (docs/briefs/31-storage-quota.md): format
// byte counts, decide how much a pick still needs and how much is available.
// Pure logic: no DOM, runs in Node and in the browser.

export interface FileSize {
  kind: string;
  name: string;
  size: number;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}

export function bytesNeeded(picked: readonly FileSize[], stored: readonly FileSize[]): number {
  const have = new Set(
    stored.map((entry) => `${entry.kind}\u0000${entry.name.toLowerCase()}\u0000${entry.size}`),
  );
  let needed = 0;
  for (const entry of picked) {
    const key = `${entry.kind}\u0000${entry.name.toLowerCase()}\u0000${entry.size}`;
    if (!have.has(key)) needed += entry.size;
  }
  return needed;
}

export function available(estimate: { usage?: number; quota?: number }): number | undefined {
  if (estimate.quota === undefined) return undefined;
  return estimate.quota - (estimate.usage ?? 0);
}
