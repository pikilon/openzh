// Launcher page logic (docs/briefs/5c-launcher.md): the player picks their
// game install folder, the archives are classified and copied into OPFS, and
// the engine runs from them. The DOM element ids are the page's contract.

import { classifyArchives, REQUIRED, type GameKind, type InstallReport } from "./install";
import { storeFiles, listStored, clearStored, type StoredFile } from "./opfs-store";
import { fetchLocalArchive, fetchLocalIndex } from "./local-gamedata";
import { prepareEngineOptions } from "./engine";
import { currentEnv, missingFeatures } from "./features";
import { available, bytesNeeded, formatBytes } from "./storage";

type Outcome = { status: "resolved" } | { status: "error"; message: string };
type Page = Window & typeof globalThis & { __zhwpLog?: string[]; __zhwpDone?: Outcome };

function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (element === null) throw new Error(`missing #${id}`);
  return element as T;
}

const input = byId<HTMLInputElement>("folder-input");
const status = byId<HTMLElement>("status");
const progress = byId<HTMLProgressElement>("import-progress");
const summary = byId<HTMLElement>("stored-summary");
const storage = byId<HTMLElement>("storage");
const storageWarning = byId<HTMLElement>("storage-warning");
const play = byId<HTMLButtonElement>("play");
const clear = byId<HTMLButtonElement>("clear");
const canvas = byId<HTMLCanvasElement>("canvas");
const engineError = byId<HTMLElement>("engine-error");
const picker = byId<HTMLElement>("picker");
const unsupported = byId<HTMLElement>("unsupported");
const playControls = byId<HTMLElement>("play-controls");
const screen = byId<HTMLElement>("screen");
const fullscreen = byId<HTMLButtonElement>("fullscreen");

// The path the folder picker gives the file under: `webkitRelativePath`
// (empty when the browser gave none, then the name alone).
function pathOf(file: File): string {
  const path = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
  return path !== undefined && path !== "" ? path : file.name;
}

function hasRequired(stored: readonly { name: string }[]): boolean {
  const names = new Set(stored.map((file) => file.name.toLowerCase()));
  return [...REQUIRED.zh, ...REQUIRED.generals].every((name) => names.has(name.toLowerCase()));
}

function showProgress(value: number, max: number): void {
  progress.hidden = false;
  progress.max = max;
  progress.value = value;
}

function hideProgress(): void {
  progress.hidden = true;
  progress.value = 0;
  progress.removeAttribute("value");
}

function hideStorageWarning(): void {
  storageWarning.hidden = true;
  storageWarning.textContent = "";
}

// The estimate is a hint, not a limit: Brave reports a fixed quota, so a
// shortage warns the player and lets the import try anyway.
function showStorageWarning(availableBytes: number, neededBytes: number): void {
  storageWarning.textContent =
    `The browser reports ${formatBytes(availableBytes)} available; ` +
    `the import needs ${formatBytes(neededBytes)}.`;
  storageWarning.hidden = false;
}

function showStored(stored: StoredFile[]): void {
  summary.textContent = `Stored: ${stored.length} archives`;
  play.disabled = !hasRequired(stored);
}

function fail(message: unknown): void {
  status.textContent = String(message instanceof Error ? message.message : message);
  hideProgress();
}

async function refreshStorage(): Promise<void> {
  const manager = navigator.storage;
  if (typeof manager.estimate !== "function") {
    storage.textContent = "Storage: unknown";
    return;
  }
  let estimate: { usage?: number; quota?: number };
  try {
    estimate = await manager.estimate();
  } catch {
    storage.textContent = "Storage: unknown";
    return;
  }
  let text = `Storage: ${formatBytes(estimate.usage ?? 0)} of ${formatBytes(estimate.quota ?? 0)}`;
  if (typeof manager.persisted === "function") {
    try {
      if (await manager.persisted()) text += " (persistent)";
    } catch {
      // Persistence is only an annotation: show the sizes regardless.
    }
  }
  storage.textContent = text;
}

async function refresh(): Promise<void> {
  showStored(await listStored());
  await refreshStorage();
}

// Classifies the picked folder and writes `#status` before the first await:
// the whole rejection is decided from the names alone, and a later task must
// never find the state text empty.
function classifyPicked(files: FileList): { picked: File[]; report: InstallReport } | null {
  if (files.length === 0) return null;
  const picked = Array.from(files);
  const report = classifyArchives(picked.map(pathOf));
  if (report.missing.length > 0) {
    // A folder without every required archive stores nothing at all.
    status.textContent = `Missing: ${report.missing.join(", ")}`;
    hideProgress();
  } else {
    status.textContent = "Importing";
    showProgress(0, 100);
  }
  play.disabled = true;
  return { picked, report };
}

// One archive to store, from whichever source. `load` is only called when the
// archive is actually written, so the local game folder is not fetched again
// on a reload that already has the files.
interface ImportEntry {
  kind: GameKind;
  name: string;
  size: number;
  load(): Promise<Blob>;
}

// The tail shared by a picked folder and the local game folder: the storage
// warning (#70), the copies and the same failure handling for both. `entries`
// holds only the archives that have to be written.
async function storeEntries(entries: readonly ImportEntry[], stored: readonly StoredFile[]): Promise<void> {
  const manager = navigator.storage;
  if (typeof manager.persist === "function") {
    // Asking does not block the import: the result only labels the storage.
    void manager.persist().catch(() => undefined);
  }
  let free: number | undefined;
  if (typeof manager.estimate === "function") {
    try {
      free = available(await manager.estimate());
    } catch {
      free = undefined;
    }
  }
  if (free !== undefined) {
    const needed = bytesNeeded(
      entries.map((entry) => ({ kind: entry.kind, name: entry.name, size: entry.size })),
      stored,
    );
    if (free < needed) showStorageWarning(free, needed);
  }
  const total = entries.reduce((sum, entry) => sum + entry.size, 0);
  let done = 0;
  try {
    for (const entry of entries) {
      const file = await entry.load();
      await storeFiles(
        [{ kind: entry.kind, name: entry.name, file }],
        (doneBytes) => showProgress(done + doneBytes, total),
      );
      done += file.size;
    }
  } catch (error) {
    // Whatever was copied before the failure stays; report it and keep Play
    // pointing at the archives that are actually stored.
    hideProgress();
    const named = error as { name?: string; message?: string };
    status.textContent = `Import failed: ${named.name ?? "Error"}: ${named.message ?? ""}`;
    await refresh();
    return;
  }
  hideProgress();
  status.textContent = "Ready";
  await refresh();
}

async function importFolder(files: FileList): Promise<void> {
  hideStorageWarning();
  const choice = classifyPicked(files);
  if (choice === null) return;
  const { picked, report } = choice;
  const stored = await listStored();
  if (report.missing.length > 0) {
    showStored(stored);
    return;
  }
  const chosen = new Map(picked.map((file) => [pathOf(file), file]));
  const entries: ImportEntry[] = report.archives.map((entry) => {
    const file = chosen.get(entry.path) as Blob;
    return {
      kind: entry.kind as GameKind,
      name: entry.name,
      size: file.size,
      load: async () => file,
    };
  });
  await storeEntries(entries, stored);
}

// Imports the folder the development server exposes (issue #72) exactly as a
// folder pick of the same files would. Without an index (or with
// `?gamedata=off`) it touches nothing and the page behaves as before.
async function importLocalGameData(): Promise<void> {
  if (new URLSearchParams(window.location.search).get("gamedata") === "off") return;
  const index = await fetchLocalIndex();
  if (index === null) return;
  hideStorageWarning();
  const report = classifyArchives(index.map((file) => file.path));
  play.disabled = true;
  if (report.missing.length > 0) {
    // A folder without every required archive stores nothing at all.
    status.textContent = `Missing: ${report.missing.join(", ")}`;
    hideProgress();
    showStored(await listStored());
    return;
  }
  status.textContent = "Importing from the local game folder";
  showProgress(0, 100);
  const stored = await listStored();
  const alreadyStored = new Set(
    stored.map((file) => `${file.kind}\u0000${file.name}\u0000${file.size}`),
  );
  const sizes = new Map(index.map((file) => [file.path, file.size]));
  const entries: ImportEntry[] = [];
  for (const archive of report.archives) {
    const size = sizes.get(archive.path);
    if (size === undefined) continue;
    // Same kind, name and size already stored: fetch nothing on a reload.
    if (alreadyStored.has(`${archive.kind}\u0000${archive.name}\u0000${size}`)) continue;
    entries.push({
      kind: archive.kind as GameKind,
      name: archive.name,
      size,
      load: () => fetchLocalArchive(archive.path),
    });
  }
  await storeEntries(entries, stored);
}

// Issue #91: the game plays in the page, and the Fullscreen button above it
// puts #screen in the browser's fullscreen mode. Play never asks for it: SDL
// drops a page-owned fullscreen while the engine starts, so the player presses
// the button once the game is up, and again after any exit. The engine and its
// render resolution do not change: only the canvas's CSS size does, because the
// engine maps the mouse through the element box.
let engineFailed = false;

// A browser without the Fullscreen API offers no button at all.
function canFullscreen(): boolean {
  return typeof screen.requestFullscreen === "function";
}

function leaveFullscreen(): void {
  if (document.fullscreenElement !== null) void document.exitFullscreen().catch(() => undefined);
}

// The largest box with the drawing buffer's aspect ratio that fits the screen;
// the flex layout of #screen:fullscreen centres it. The drawing buffer itself
// is never written.
function fitFullscreenCanvas(): void {
  if (document.fullscreenElement !== screen) return;
  const bufferWidth = canvas.width;
  const bufferHeight = canvas.height;
  if (bufferWidth <= 0 || bufferHeight <= 0) return;
  const scale = Math.min(window.innerWidth / bufferWidth, window.innerHeight / bufferHeight);
  canvas.style.width = `${bufferWidth * scale}px`;
  canvas.style.height = `${bufferHeight * scale}px`;
}

// Out of fullscreen #80's page CSS fits the canvas to the page again.
function unfullscreenCanvas(): void {
  canvas.style.width = "";
  canvas.style.height = "";
}

// Issue #97: while the game runs windowed, the canvas is the largest box with
// the drawing buffer's aspect ratio that fits between the bottom of
// #play-controls and the bottom of the window, inside the body's content
// width; `margin-inline: auto` centres it. The body's horizontal padding is the
// gap to the window, and the drawing buffer itself is never written.
function fitWindowedCanvas(): void {
  if (document.fullscreenElement !== null || canvas.hidden) return;
  const bufferWidth = canvas.width;
  const bufferHeight = canvas.height;
  if (bufferWidth <= 0 || bufferHeight <= 0) return;
  const bodyStyle = window.getComputedStyle(document.body);
  const availableWidth =
    document.documentElement.clientWidth -
    parseFloat(bodyStyle.paddingLeft) -
    parseFloat(bodyStyle.paddingRight);
  const controlsBottom = playControls.hidden ? 0 : playControls.getBoundingClientRect().bottom;
  const availableHeight = window.innerHeight - controlsBottom;
  if (availableWidth <= 0 || availableHeight <= 0) return;
  const scale = Math.min(availableWidth / bufferWidth, availableHeight / bufferHeight);
  // Whole pixels, rounded down: the layout would otherwise keep the fraction of
  // a pixel that puts the canvas past the bottom of the window.
  canvas.style.width = `${Math.floor(bufferWidth * scale)}px`;
  canvas.style.height = `${Math.floor(bufferHeight * scale)}px`;
}

// The displayed size the page's current mode needs: the whole screen in
// fullscreen (#91), the space below the page text while windowed (#97).
function fitCanvas(): void {
  if (document.fullscreenElement === screen) fitFullscreenCanvas();
  else fitWindowedCanvas();
}

function onFullscreenChange(): void {
  if (document.fullscreenElement !== screen) {
    unfullscreenCanvas();
    // The windowed playing layout (#97) is what the page returns to.
    fitWindowedCanvas();
    return;
  }
  // A failed engine must not keep the screen: the message has to stay readable
  // and #fullscreen is not offered again, even when the browser grants a
  // request that was still pending when the engine aborted.
  if (engineFailed) {
    leaveFullscreen();
    return;
  }
  fitFullscreenCanvas();
  // The keyboard input follows the game (#28) without another click.
  canvas.focus();
  // The fullscreen layout lands in the next frame: fit again then, against the
  // screen size it really gives the canvas.
  window.requestAnimationFrame(fitFullscreenCanvas);
}

function enterFullscreen(): void {
  if (!canFullscreen()) return;
  const requested = screen.requestFullscreen();
  void Promise.resolve(requested).then(
    () => {
      if (engineFailed) leaveFullscreen();
      else {
        fitFullscreenCanvas();
        canvas.focus();
      }
    },
    // A refused request keeps the game windowed and shows no error: the
    // button stays so the player can retry.
    () => undefined,
  );
}

// Issue #99: the game is silent while the page is hidden or the window has lost
// focus, and comes back only when it is visible and focused again. The engine
// object is the module the factory resolved to; the page keeps it because Play
// may be pressed from a page that was never visible or focused. Visibility wins
// over focus: a focused page in a hidden document stays muted.
type EngineModule = { _GeneralsXSetAudioMuted?: (muted: number) => unknown };

let engineModule: EngineModule | null = null;
let windowFocused = document.hasFocus();

// 1 while the game must be silent, 0 only while the page is visible and focused.
function muteValue(): number {
  return document.visibilityState === "visible" && windowFocused ? 0 : 1;
}

// Re-applied when the module becomes available and on every later change. A
// build without the export is ignored, and the game keeps playing.
function applyMute(): void {
  const engine = engineModule;
  if (engine === null) return;
  const setMuted = engine._GeneralsXSetAudioMuted;
  if (typeof setMuted !== "function") return;
  setMuted.call(engine, muteValue());
}

async function playNow(): Promise<void> {
  play.disabled = true;
  input.disabled = true;
  canvas.hidden = false;
  canvas.focus();
  picker.hidden = true;
  // The controls sit above the game from Play on, so the player can go
  // fullscreen while it runs.
  engineFailed = false;
  playControls.hidden = false;
  fullscreen.hidden = !canFullscreen();
  // Issue #97: from here the page is the window's width and the canvas takes
  // the space below the controls. The drawing buffer may still have the
  // attribute's size; the observer below fits it again when the engine writes
  // it.
  document.body.classList.add("playing");
  fitWindowedCanvas();
  status.textContent = "Starting";
  // The `module` query parameter lets tests start a fake engine instead of the
  // real one (docs/briefs/29-launcher-errors.md), the same rule as smoke.js.
  const params = new URLSearchParams(window.location.search);
  const moduleUrl = params.get("module") ?? "/engine/GeneralsXZH.js";
  const page = window as Page;
  page.__zhwpLog = [];
  page.__zhwpDone = undefined;
  const record = (line: string) => {
    page.__zhwpLog?.push(line);
  };
  // An abort after the factory resolved replaces the resolved outcome.
  const reportError = (message: unknown) => {
    const text = String(message ?? "").trim() || "unknown error";
    status.textContent = `Engine failed: ${text}`;
    engineError.textContent = text;
    engineError.hidden = false;
    // #91: the failure ends the playing view's fullscreen session, and the
    // button is not offered again, so the message stays readable.
    engineFailed = true;
    fullscreen.hidden = true;
    leaveFullscreen();
    record("[page] " + text);
    page.__zhwpDone = { status: "error", message: text };
  };
  try {
    const module = (await import(moduleUrl)) as { default?: unknown };
    if (typeof module.default !== "function") {
      throw new Error(`module ${moduleUrl} has no default-exported factory`);
    }
    const options = await prepareEngineOptions({
      canvas,
      arguments: ["-win"],
      print: record,
      printErr: record,
      onAbort: reportError,
    });
    const engine = (await (module.default as (options: unknown) => Promise<unknown>)(options)) as EngineModule;
    // Issue #99: keep the object the factory resolved to and tell it the page's
    // current state, since Play may have been pressed from a hidden or
    // unfocused page.
    engineModule = engine ?? null;
    applyMute();
    if (page.__zhwpDone === undefined) {
      page.__zhwpDone = { status: "resolved" };
      status.textContent = "Ready";
    }
  } catch (error) {
    reportError(error);
  }
}

async function clearAll(): Promise<void> {
  // The picker controls stay enabled while the store is cleared: a folder
  // picked during those milliseconds would otherwise be classified into a
  // stale, empty summary.
  play.disabled = true;
  await clearStored();
  hideStorageWarning();
  status.textContent = "";
  hideProgress();
  await refresh();
}

// A browser without every feature cannot import or play: say so before the
// player spends minutes picking and copying several GB, and touch no stored
// data at all in that case.
const missing = missingFeatures(currentEnv());
if (missing.length > 0) {
  unsupported.textContent = `Missing browser features: ${missing.join(", ")}`;
  unsupported.hidden = false;
  input.disabled = true;
  play.disabled = true;
} else {
  input.addEventListener("change", () => {
    void importFolder(input.files ?? ([] as unknown as FileList)).catch(fail);
  });

  play.addEventListener("click", () => {
    void playNow();
  });

  clear.addEventListener("click", () => {
    void clearAll().catch(fail);
  });

  // The game plays with the right mouse button: the browser's context menu must
  // never open over the canvas, and only over the canvas.
  canvas.addEventListener("contextmenu", (event) => {
    event.preventDefault();
  });

  // The player asks for fullscreen from the click's own user gesture; the
  // browser's Esc, or the page's exit, brings the windowed layout back (#91).
  fullscreen.addEventListener("click", () => {
    enterFullscreen();
  });
  document.addEventListener("fullscreenchange", onFullscreenChange);

  // The engine writes its render resolution into the canvas backing size, so a
  // change re-fits the canvas to the new aspect ratio: on the screen in
  // fullscreen (#91), in the page while windowed (#97).
  new MutationObserver(fitCanvas).observe(canvas, {
    attributes: true,
    attributeFilter: ["width", "height"],
  });
  window.addEventListener("resize", fitCanvas);

  // Issue #99: the window's focus and the document's visibility decide whether
  // the game is heard; applyMute() re-reads both, so the order they arrive in
  // does not matter. Before Play there is no engine object yet: the state is
  // applied when the module resolves.
  window.addEventListener("blur", () => {
    windowFocused = false;
    applyMute();
  });
  window.addEventListener("focus", () => {
    windowFocused = true;
    applyMute();
  });
  document.addEventListener("visibilitychange", applyMute);

  // The development server may expose the owner's game folder (issue #72):
  // import it on load, exactly as a folder pick, when it is there. Doing it
  // after the first refresh keeps the summary from racing the import.
  void refresh()
    .then(() => importLocalGameData())
    .catch(fail);
}
