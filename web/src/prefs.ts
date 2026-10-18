// The player's launcher preferences (docs/briefs/159-launcher-shell.md): the
// mute choice and the performance overlay. Both live in localStorage as "1" or
// "0"; a browser that denies storage keeps the in-memory default. Pure DOM
// storage helpers: no other module state.

const MUTED_KEY = "openzh.muted";
const PERFORMANCE_OVERLAY_KEY = "openzh.performanceOverlay";

function readFlag(key: string, fallback: boolean): boolean {
  try {
    const value = window.localStorage.getItem(key);
    if (value === "1") return true;
    if (value === "0") return false;
  } catch {
    // Storage can be denied (private windows, blocked third-party storage):
    // the page then runs with the default and never fails to load.
  }
  return fallback;
}

function writeFlag(key: string, value: boolean): void {
  try {
    window.localStorage.setItem(key, value ? "1" : "0");
  } catch {
    // The choice still applies to this page; only persistence is lost.
  }
}

// The user's own mute choice, off by default.
export function readMuted(): boolean {
  return readFlag(MUTED_KEY, false);
}

export function writeMuted(muted: boolean): void {
  writeFlag(MUTED_KEY, muted);
}

// The engine's debug overlay, hidden by default.
export function readPerformanceOverlay(): boolean {
  return readFlag(PERFORMANCE_OVERLAY_KEY, false);
}

export function writePerformanceOverlay(visible: boolean): void {
  writeFlag(PERFORMANCE_OVERLAY_KEY, visible);
}
