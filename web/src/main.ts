// Launcher shell logic (docs/briefs/159-launcher-shell.md): the page is a
// command console around the game. The top bar is the only chrome, the engine
// starts by itself once its archives are stored, and a modal menu holds the
// game-data controls and the player's preferences. The DOM element ids are the
// page's contract.

import { REQUIRED } from "./install";
import { listStored, removeExtra, clearStored, type StoredFile } from "./opfs-store";
import { prepareEngineOptions, saveUserData } from "./engine";
import { currentEnv, missingFeatures } from "./features";
import { available, formatBytes } from "./storage";
import { ImportError, describeImportError } from "./import-error";
import { importZips, type ImportProgress } from "./zip-import";
import {
  readMuted,
  readPerformanceOverlay,
  writeMuted,
  writePerformanceOverlay,
} from "./prefs";
import { byId, closeDialog, openDialog } from "./shell";
import { listSavedGames, savedGamesZip } from "./saves";
import { BackupError, exportBackup, importBackup, type BackupKind } from "./user-backup";
import { resumeUserDataSaves, suspendUserDataSaves } from "./user-data";
import { createTouchControls } from "./touch";

type Outcome = { status: "resolved" } | { status: "error"; message: string };
type Page = Window & typeof globalThis & { __zhwpLog?: string[]; __zhwpDone?: Outcome };

// The one state `body[data-state]` carries at any time.
type PageState =
  | "boot"
  | "no-assets"
  | "importing"
  | "starting"
  | "playing"
  | "error"
  | "unsupported";

// The exports the page uses on the object the engine factory resolves to.
type EngineModule = {
  _GeneralsXSetAudioMuted?: (muted: number) => unknown;
  _GeneralsXSetDebugOverlay?: (visible: number) => unknown;
  _GeneralsXPanCamera?: (x: number, y: number) => unknown;
  FS?: { syncfs?: (populate: boolean, callback: (error: unknown | null) => void) => void };
};

const status = byId<HTMLElement>("status");
const progress = byId<HTMLProgressElement>("import-progress");
const summary = byId<HTMLElement>("stored-summary");
const storage = byId<HTMLElement>("storage");
const storageWarning = byId<HTMLElement>("storage-warning");
const canvas = byId<HTMLCanvasElement>("canvas");
const engineError = byId<HTMLElement>("engine-error");
const unsupported = byId<HTMLElement>("unsupported");
const screen = byId<HTMLElement>("screen");
const topbar = byId<HTMLElement>("topbar");
const fullscreen = byId<HTMLButtonElement>("fullscreen");
const mute = byId<HTMLButtonElement>("mute");
const menuButton = byId<HTMLButtonElement>("menu-button");
const importDetail = byId<HTMLElement>("import-detail");
const importCurrent = byId<HTMLElement>("import-current");
const importCancel = byId<HTMLButtonElement>("import-cancel");
const importError = byId<HTMLElement>("import-error");
const zipInput = byId<HTMLInputElement>("zip-input");
const dropZone = byId<HTMLElement>("drop-zone");
const loader = byId<HTMLElement>("loader");
const loading = byId<HTMLElement>("loading");
const errorPanel = byId<HTMLElement>("error-panel");
const retry = byId<HTMLButtonElement>("retry");
const menu = byId<HTMLDialogElement>("menu");
const menuClose = byId<HTMLButtonElement>("menu-close");
const menuStored = byId<HTMLElement>("menu-stored");
const menuStorage = byId<HTMLElement>("menu-storage");
const reload = byId<HTMLButtonElement>("reload");
const reloadDialog = byId<HTMLDialogElement>("reload-dialog");
const reloadWarning = byId<HTMLElement>("reload-warning");
const reloadCancel = byId<HTMLButtonElement>("reload-cancel");
const reloadConfirm = byId<HTMLButtonElement>("reload-confirm");
const fpsToggle = byId<HTMLInputElement>("fps-toggle");
const about = byId<HTMLButtonElement>("about");
const aboutDialog = byId<HTMLDialogElement>("about-dialog");
const aboutClose = byId<HTMLButtonElement>("about-close");
const exportSaves = byId<HTMLButtonElement>("export-saves");
const savesSummary = byId<HTMLElement>("saves-summary");
const savesStatus = byId<HTMLElement>("saves-status");
const exportSettings = byId<HTMLButtonElement>("export-settings");
const exportEverything = byId<HTMLButtonElement>("export-everything");
const importSettings = byId<HTMLButtonElement>("import-settings");
const importSettingsInput = byId<HTMLInputElement>("import-settings-input");
const settingsStatus = byId<HTMLElement>("settings-status");
const donate = byId<HTMLButtonElement>("donate");
const gameMenu = byId<HTMLButtonElement>("game-menu");
const donateDialog = byId<HTMLDialogElement>("donate-dialog");
const donateClose = byId<HTMLButtonElement>("donate-close");

// Set once an import asks for persisting storage and the browser denies it
// (issue #129): the storage line then says the browser may clear it.
let storageMayBeCleared = false;
const STORAGE_MAY_BE_CLEARED = " Storage may be cleared by the browser when space is low.";

let pageState: PageState = "boot";
let starting = false;
let engineFailed = false;
let engineModule: EngineModule | null = null;
let storedFiles: StoredFile[] = [];
let importAbort: AbortController | null = null;
let importing = false;

// The touch overlay (#187) reads the engine lazily: it is created before the
// first start and must not call a null engine.
const touch = createTouchControls({
  canvas,
  overlay: byId<HTMLElement>("touch-controls"),
  toggle: byId<HTMLButtonElement>("touch-toggle"),
  left: byId<HTMLButtonElement>("touch-left"),
  right: byId<HTMLButtonElement>("touch-right"),
  multi: byId<HTMLButtonElement>("touch-multi"),
  joystick: byId<HTMLElement>("touch-joystick"),
  knob: byId<HTMLElement>("touch-knob"),
  engine: () => engineModule,
});

// The player's own choices (persisted by src/prefs.ts).
let userMuted = readMuted();
let performanceOverlay = readPerformanceOverlay();

// The browser's focus state, tracked from the events rather than polled: the
// engine is silent while the document is hidden or the window has lost focus.
let windowFocused = document.hasFocus();

// The features the launcher needs; a non-empty list means `unsupported`.
const missingFeatureNames = missingFeatures(currentEnv());

function setState(next: PageState): void {
  pageState = next;
  document.body.dataset.state = next;
}

function hasRequired(stored: readonly { name: string }[]): boolean {
  const names = new Set(stored.map((file) => file.name.toLowerCase()));
  return [...REQUIRED.zh, ...REQUIRED.generals].every((name) => names.has(name.toLowerCase()));
}

// ----- status, storage and import lines -----

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

function storedText(count: number): string {
  return `Stored: ${count} archives`;
}

// The hidden summary is the page's machine-readable archive count; the menu
// shows the same line and the reload action follows the same count.
function showStored(stored: StoredFile[]): void {
  storedFiles = stored;
  const text = storedText(stored.length);
  summary.textContent = text;
  menuStored.textContent = text;
  reload.disabled = stored.length === 0;
}

function hideImportError(): void {
  importError.hidden = true;
  importError.removeAttribute("data-code");
  importError.textContent = "";
}

// Issue #128: the typed failure's message and, below it, its hint; the code
// goes on `data-code` so the failure is machine-readable.
function showImportError(error: unknown): void {
  const text = describeImportError(error);
  const message = document.createElement("p");
  message.textContent = text.message;
  const hint = document.createElement("p");
  hint.textContent = text.hint;
  importError.replaceChildren(message, hint);
  importError.setAttribute("data-code", text.code);
  importError.hidden = false;
}

function hideImportDetail(): void {
  importDetail.hidden = true;
  importDetail.textContent = "";
  importCurrent.hidden = true;
  importCurrent.textContent = "";
  importCancel.hidden = true;
  hideProgress();
}

function megabytes(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1);
}

// `calculating…` until the importer has a speed, then m:ss or h:mm:ss.
function formatEta(seconds: number | null): string {
  if (seconds === null) return "calculating…";
  const whole = Math.max(0, Math.round(seconds));
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const rest = String(whole % 60).padStart(2, "0");
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, "0")}:${rest}`;
  return `${minutes}:${rest}`;
}

// "<doneMB> MB of <totalMB> MB · <filesDone> of <filesTotal> files · <speed> MB/s · <eta> left"
function showImportProgress(state: ImportProgress): void {
  showProgress(state.doneBytes, Math.max(state.totalBytes, 1));
  importDetail.textContent =
    `${megabytes(state.doneBytes)} MB of ${megabytes(state.totalBytes)} MB · ` +
    `${state.filesDone} of ${state.filesTotal} files · ` +
    `${megabytes(state.bytesPerSecond)} MB/s · ${formatEta(state.etaSeconds)} left`;
  importDetail.hidden = false;
  if (state.currentFile !== "") {
    importCurrent.textContent = state.currentFile;
    importCurrent.hidden = false;
  }
}

function fail(message: unknown): void {
  status.textContent = String(message instanceof Error ? message.message : message);
  hideProgress();
  setState("no-assets");
}

function showStorageText(text: string): void {
  const value = storageMayBeCleared ? `${text}${STORAGE_MAY_BE_CLEARED}` : text;
  storage.textContent = value;
  menuStorage.textContent = value;
}

async function refreshStorage(): Promise<void> {
  const manager = navigator.storage;
  if (typeof manager.estimate !== "function") {
    showStorageText("Storage: unknown");
    return;
  }
  let estimate: { usage?: number; quota?: number };
  try {
    estimate = await manager.estimate();
  } catch {
    showStorageText("Storage: unknown");
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
  showStorageText(text);
}

async function refresh(): Promise<void> {
  try {
    showStored(await listStored());
  } catch {
    showStored([]);
  }
  await refreshStorage();
}

// ----- preferences: mute and the performance overlay -----

// The event-tracked flag can miss the one `focus` event of a navigation
// started from the address bar (issue #186). The live query is used only to
// turn the flag back on: a synthetic `blur` in the tests, or a really
// unfocused window, must keep it off.
function refreshFocusFromDocument(): void {
  if (document.hasFocus()) windowFocused = true;
}

function audibleMuted(): boolean {
  return userMuted || document.visibilityState !== "visible" || !windowFocused;
}

// Browsers only start audio after a user gesture (autoplay policy), and the
// game starts by itself, so until the first click, tap or key the sound is
// blocked even when the player has not muted it. The engine's own resume runs
// inside that gesture through applyMute.
let soundAllowed = (() => {
  const activation = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation;
  return activation === undefined || activation.hasBeenActive;
})();

function soundBlocked(): boolean {
  return !soundAllowed && !userMuted;
}

// The engine suspends its audio contexts while a map loads and resumes them
// afterwards; a resume the browser refused (no gesture yet) left the game
// silent. Inside a gesture every context is resumed again.
function resumeEngineAudio(): void {
  const devices = (window as Window & { miniaudio?: { devices?: ({ webaudio?: AudioContext } | null)[] } })
    .miniaudio?.devices;
  for (const device of devices ?? []) {
    const context = device?.webaudio;
    if (context !== undefined && context.state === "suspended") {
      void context.resume().catch(() => undefined);
    }
  }
}

function allowSound(): void {
  resumeEngineAudio();
  if (soundAllowed) return;
  soundAllowed = true;
  updateMuteButton();
  applyMute();
}

function updateMuteButton(): void {
  const blocked = soundBlocked();
  const label = blocked
    ? "Sound is blocked by the browser: press to turn it on"
    : userMuted
      ? "Unmute game audio"
      : "Mute game audio";
  mute.toggleAttribute("data-blocked", blocked);
  mute.setAttribute("aria-pressed", userMuted ? "true" : "false");
  mute.setAttribute("aria-label", label);
  mute.title = label;
}

// Re-applied when the module becomes available and on every later change. A
// build without the export is ignored, and the game keeps playing.
function applyMute(): void {
  const engine = engineModule;
  if (engine === null) return;
  const setMuted = engine._GeneralsXSetAudioMuted;
  if (typeof setMuted !== "function") return;
  try {
    setMuted.call(engine, audibleMuted() ? 1 : 0);
  } catch {
    // The engine object can be gone with the game; there is nothing to tell.
  }
}

function applyPerformanceOverlay(): void {
  const engine = engineModule;
  if (engine === null) return;
  const setOverlay = engine._GeneralsXSetDebugOverlay;
  if (typeof setOverlay !== "function") return;
  try {
    setOverlay.call(engine, performanceOverlay ? 1 : 0);
  } catch {
    // Same as the mute export: a missing or failed export is a no-op.
  }
}

// ----- engine start -----

// A browser without the Fullscreen API offers no button at all.
function canFullscreen(): boolean {
  return typeof screen.requestFullscreen === "function";
}

function updateFullscreenButton(): void {
  const active = document.fullscreenElement === screen;
  const label = active ? "Exit fullscreen" : "Enter fullscreen";
  fullscreen.setAttribute("aria-pressed", active ? "true" : "false");
  fullscreen.setAttribute("aria-label", label);
  fullscreen.title = label;
}

function leaveFullscreen(): void {
  if (typeof document.exitFullscreen !== "function") return;
  if (document.fullscreenElement !== null) {
    void document.exitFullscreen().catch(() => undefined);
  }
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
  canvas.style.width = `${Math.floor(bufferWidth * scale)}px`;
  canvas.style.height = `${Math.floor(bufferHeight * scale)}px`;
}

// Out of fullscreen the windowed fit sizes the canvas again.
function unfullscreenCanvas(): void {
  canvas.style.width = "";
  canvas.style.height = "";
}

// Issue #97: while the game runs windowed, the canvas is the largest box with
// the drawing buffer's aspect ratio that fits between the bottom of #topbar and
// the bottom of the window; `justify-content: center` on #screen centres it
// horizontally. The drawing buffer itself is never written.
function fitWindowedCanvas(): void {
  if (document.fullscreenElement !== null || canvas.hidden) return;
  const bufferWidth = canvas.width;
  const bufferHeight = canvas.height;
  if (bufferWidth <= 0 || bufferHeight <= 0) return;
  const availableWidth = window.innerWidth;
  const availableHeight = window.innerHeight - topbar.getBoundingClientRect().bottom;
  if (availableWidth <= 0 || availableHeight <= 0) return;
  const scale = Math.min(availableWidth / bufferWidth, availableHeight / bufferHeight);
  // Whole pixels, rounded down: the layout would otherwise keep the fraction of
  // a pixel that puts the canvas past the bottom of the window.
  canvas.style.width = `${Math.floor(bufferWidth * scale)}px`;
  canvas.style.height = `${Math.floor(bufferHeight * scale)}px`;
}

function fitCanvas(): void {
  if (document.fullscreenElement === screen) fitFullscreenCanvas();
  else fitWindowedCanvas();
}

function onFullscreenChange(): void {
  updateFullscreenButton();
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

// The game is played in landscape. The browser only allows the lock in
// fullscreen or in the installed app; elsewhere the request is refused quietly
// (the manifest also asks for landscape).
function lockLandscape(): void {
  const orientation = screen.orientation as ScreenOrientation & {
    lock?: (orientation: string) => Promise<void>;
  };
  if (orientation === undefined || typeof orientation.lock !== "function") return;
  try {
    void orientation.lock("landscape").catch(() => undefined);
  } catch {
    // Some browsers throw synchronously instead of rejecting.
  }
}

// Opens the in-game menu the way the Esc key does. A real Esc can be eaten
// by the browser (it leaves pointer lock or fullscreen first), so the top bar
// button sends the key straight to the engine, which listens on window.
function openGameMenu(): void {
  if (pageState !== "playing") return;
  canvas.focus();
  for (const type of ["keydown", "keyup"] as const) {
    canvas.dispatchEvent(
      new KeyboardEvent(type, {
        key: "Escape",
        code: "Escape",
        keyCode: 27,
        which: 27,
        bubbles: true,
        cancelable: true,
        composed: true,
      }),
    );
  }
}

function enterFullscreen(): void {
  if (!canFullscreen()) return;
  const requested = screen.requestFullscreen();
  void Promise.resolve(requested).then(
    () => {
      if (engineFailed) leaveFullscreen();
      else {
        lockLandscape();
        fitFullscreenCanvas();
        canvas.focus();
      }
    },
    // A refused request keeps the game windowed and shows no error: the
    // button stays so the player can retry.
    () => undefined,
  );
}

function showStarting(): void {
  touch.setPlaying(false);
  gameMenu.hidden = true;
  loader.hidden = true;
  loading.hidden = false;
  errorPanel.hidden = true;
  engineError.hidden = true;
  engineError.textContent = "";
  canvas.hidden = true;
  fullscreen.disabled = true;
  fullscreen.hidden = !canFullscreen();
}

// The stored archives can be open in one page only. A second OpenZH tab or an
// installed-app window holding them makes the start fail with this name.
const FILES_IN_USE =
  "The game files are in use by another OpenZH tab or window. Close it, then press Retry.";

function describeEngineFailure(message: unknown): string {
  const text = String(message ?? "").trim() || "unknown error";
  return text.includes("NoModificationAllowedError") ? FILES_IN_USE : text;
}

// Held for the life of the page once the engine starts (the browser drops it
// when the page goes away), so a second tab learns at once that the game is
// already running elsewhere instead of failing on the file locks.
let engineLockHeld = false;

function acquireEngineLock(): Promise<boolean> {
  const locks = (navigator as Navigator & { locks?: LockManager }).locks;
  if (engineLockHeld || locks === undefined) return Promise.resolve(true);
  return new Promise((resolve) => {
    locks
      .request("openzh-engine", { ifAvailable: true }, (lock) => {
        if (lock === null) {
          resolve(false);
          return undefined;
        }
        engineLockHeld = true;
        resolve(true);
        return new Promise<void>(() => undefined);
      })
      .catch(() => resolve(true));
  });
}

function reportEngineError(message: unknown, record: (line: string) => void): void {
  const text = describeEngineFailure(message);
  engineFailed = true;
  engineModule = null;
  touch.setPlaying(false);
  gameMenu.hidden = true;
  setState("error");
  status.textContent = `Engine failed: ${text}`;
  engineError.textContent = text;
  engineError.hidden = false;
  errorPanel.hidden = false;
  loading.hidden = true;
  loader.hidden = true;
  canvas.hidden = true;
  fullscreen.hidden = true;
  fullscreen.disabled = true;
  leaveFullscreen();
  record("[page] " + text);
  (window as Page).__zhwpDone = { status: "error", message: text };
}

// Issue #91: the game plays in the page, and the Fullscreen button above it
// puts #screen in the browser's fullscreen mode. The engine and its render
// resolution do not change: only the canvas's CSS size does, because the
// engine maps the mouse through the element box.

// The `module` query parameter lets tests start a fake engine instead of the
// real one (docs/briefs/29-launcher-errors.md), the same rule as smoke.js.
function engineModuleUrl(): string {
  const params = new URLSearchParams(window.location.search);
  return params.get("module") ?? "/engine/GeneralsXZH.js";
}

// src/engine.ts keeps the archives open through the FileBridge and releases
// them on pagehide, because the worker's sync access handles stay locked while
// it lives. An engine attempt that ended, or a reload that deletes the store,
// must hand them back first: a second attempt could not open the same files,
// and neither could the delete.
function releaseStoredArchives(): void {
  window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: false }));
}

// One engine start at a time, including the automatic one. A second call while
// starting or playing is a no-op; #retry comes from the error state.
async function startEngine(): Promise<void> {
  if (starting || pageState === "playing" || pageState === "unsupported") return;
  if (missingFeatureNames.length > 0) return;
  if (!hasRequired(storedFiles)) return;

  starting = true;
  engineFailed = false;
  engineModule = null;
  // A previous attempt may have failed with its archive handles still open.
  releaseStoredArchives();
  showStarting();
  setState("starting");
  status.textContent = "Starting";

  const page = window as Page;
  page.__zhwpLog = [];
  page.__zhwpDone = undefined;
  const record = (line: string) => {
    page.__zhwpLog?.push(line);
  };

  try {
    if (!(await acquireEngineLock())) throw new Error(FILES_IN_USE);
    const moduleUrl = engineModuleUrl();
    const module = (await import(moduleUrl)) as { default?: unknown };
    if (typeof module.default !== "function") {
      throw new Error(`module ${moduleUrl} has no default-exported factory`);
    }
    const options = await prepareEngineOptions({
      canvas,
      arguments: ["-win"],
      print: record,
      printErr: record,
      onAbort: (message: unknown) => {
        reportEngineError(message, record);
      },
    });
    const engine = (await (module.default as (options: unknown) => Promise<unknown>)(
      options,
    )) as EngineModule | null | undefined;

    // An abort during the factory already replaced this start with an error.
    if (engineFailed) return;

    engineModule = engine ?? null;
    touch.setPlaying(true);
    gameMenu.hidden = false;
    lockLandscape();
    setState("playing");
    loading.hidden = true;
    loader.hidden = true;
    errorPanel.hidden = true;
    canvas.hidden = false;
    fullscreen.hidden = !canFullscreen();
    fullscreen.disabled = false;
    fitWindowedCanvas();
    canvas.focus();
    // A navigation from the address bar may have missed the window's focus
    // event, so the flag is refreshed once the engine exists (issue #186).
    refreshFocusFromDocument();
    // Applied as soon as the engine object exists; the player may have changed
    // either choice while the archives were still loading.
    applyMute();
    applyPerformanceOverlay();
    if (page.__zhwpDone === undefined) {
      page.__zhwpDone = { status: "resolved" };
    }
    status.textContent = "Ready";
  } catch (error) {
    if (!engineFailed) reportEngineError(error, record);
  } finally {
    starting = false;
  }
}

// ----- ZIP import -----

async function requestPersist(): Promise<void> {
  const manager = navigator.storage;
  if (typeof manager.persist !== "function") return;
  // Asked once per import, before the first write. The answer only labels the
  // storage: a denial never blocks the copy.
  try {
    if (!(await manager.persist())) storageMayBeCleared = true;
  } catch {
    // Persistence is only an annotation: the import works without it.
  }
}

// The estimate is a hint, not a limit (#70): warn when the ZIPs do not fit and
// let the import try anyway. The replace rule (#157) removes everything the new
// ZIPs do not keep, so that freed space counts as available here.
async function warnIfZipsDoNotFit(zips: readonly Blob[]): Promise<void> {
  const manager = navigator.storage;
  if (typeof manager.estimate !== "function") return;
  let free: number | undefined;
  try {
    free = available(await manager.estimate());
  } catch {
    return;
  }
  if (free === undefined) return;
  let removable = 0;
  try {
    // Only the archives are stored now (issue #162), and the replace rule
    // removes those the new ZIPs do not keep.
    const stored = await listStored();
    removable = stored.reduce((sum, file) => sum + file.size, 0);
  } catch {
    // The import itself reports a storage failure; warn on free space only.
  }
  const needed = zips.reduce((sum, zip) => sum + zip.size, 0);
  if (free + removable < needed) showStorageWarning(free, needed);
}

function beginZipImport(): AbortController {
  hideImportError();
  hideStorageWarning();
  importing = true;
  setState("importing");
  status.textContent = "Importing";
  zipInput.disabled = true;
  importCancel.hidden = false;
  importCurrent.hidden = true;
  importCurrent.textContent = "";
  showProgress(0, 100);
  importDetail.textContent =
    `${megabytes(0)} MB of ${megabytes(0)} MB · 0 of 0 files · ` +
    `${megabytes(0)} MB/s · ${formatEta(null)} left`;
  importDetail.hidden = false;
  const controller = new AbortController();
  importAbort = controller;
  return controller;
}

function endZipImport(): void {
  importing = false;
  importAbort = null;
  hideImportDetail();
  zipInput.disabled = false;
  zipInput.value = "";
}

async function importZipFiles(files: readonly File[]): Promise<void> {
  const controller = beginZipImport();
  // Both are asked before the first write.
  await requestPersist();
  await warnIfZipsDoNotFit(files);
  try {
    await importZips([...files], {
      signal: controller.signal,
      onProgress: showImportProgress,
      onPhase: (phase) => {
        status.textContent =
          phase === "removing" ? "Removing the previous install" : "Importing";
      },
    });
  } catch (error) {
    endZipImport();
    if (describeImportError(error).code === "aborted") {
      // Issue #128: a cancelled import is not a failure; what was written
      // before the cancel stays stored.
      status.textContent = "Cancelled";
    } else {
      status.textContent = "Import failed";
      showImportError(error);
    }
    await refresh();
    setState("no-assets");
    return;
  }
  endZipImport();
  status.textContent = "Ready";
  await refresh();
  // Issue #159: a complete install starts the engine by itself; the player
  // never presses a Play button.
  if (hasRequired(storedFiles) && missingFeatureNames.length === 0) {
    void startEngine();
  } else {
    setState("no-assets");
  }
}

// A dropped file counts as a ZIP by its extension alone, case-insensitive.
function droppedZips(files: FileList | null): File[] {
  return Array.from(files ?? []).filter((file) => file.name.toLowerCase().endsWith(".zip"));
}

function dropZipFiles(event: DragEvent): void {
  event.preventDefault();
  dropZone.classList.remove("is-over");
  if (importing) return;
  const zips = droppedZips(event.dataTransfer?.files ?? null);
  if (zips.length === 0) {
    // Nothing is imported and the failure names the reason.
    hideImportError();
    hideImportDetail();
    status.textContent = "Import failed";
    showImportError(new ImportError("not-a-zip"));
    return;
  }
  void importZipFiles(zips).catch(fail);
}

// ----- menu and dialogs -----

function openMenu(): void {
  openDialog(menu);
  menuButton.setAttribute("aria-expanded", "true");
  void refreshSavedGames();
}

function closeMenu(): void {
  closeDialog(menu);
}

function showReloadConfirmation(): void {
  const count = storedFiles.length;
  const noun = count === 1 ? "archive" : "archives";
  reloadWarning.textContent =
    `This permanently deletes the ${count} stored ${noun}. ` +
    "The game data must be selected from the ZIP files again.";
  openDialog(reloadDialog);
}

// ----- saved games -----

let savedGameCount = 0;

// The engine flushes IDBFS every ten seconds. A save made just before the
// export would otherwise be missing, so flush when the engine has a mounted FS
// (a fake engine in the tests has none; there is nothing to flush there).
async function flushUserData(): Promise<void> {
  const engine = engineModule;
  if (engine === null || engine.FS === undefined || typeof engine.FS.syncfs !== "function") {
    return;
  }
  try {
    await saveUserData(engine);
  } catch {
    // The export reads whatever IndexedDB has; a failed flush is not fatal.
  }
}

async function readSavedGames(): Promise<Awaited<ReturnType<typeof listSavedGames>>> {
  await flushUserData();
  return listSavedGames();
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  anchor.style.display = "none";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  // The browser has taken the blob by the next task; releasing it later keeps
  // the download from seeing a revoked URL.
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function refreshSavedGames(): Promise<void> {
  exportSaves.disabled = true;
  savesSummary.textContent = "Saved games: checking…";
  savesStatus.hidden = true;
  try {
    const games = await readSavedGames();
    savedGameCount = games.length;
    savesSummary.textContent =
      games.length === 0 ? "Saved games: none" : `Saved games: ${games.length}`;
  } catch {
    savedGameCount = 0;
    savesSummary.textContent = "Saved games: unavailable";
  }
  exportSaves.disabled = savedGameCount === 0;
}

async function exportSavedGames(): Promise<void> {
  exportSaves.disabled = true;
  savesStatus.hidden = false;
  savesStatus.textContent = "Preparing the ZIP…";
  try {
    const archive = await savedGamesZip(flushUserData);
    if (archive === null) {
      savedGameCount = 0;
      savesSummary.textContent = "Saved games: none";
      savesStatus.textContent = "No saved games to export.";
      return;
    }
    savedGameCount = archive.count;
    savesSummary.textContent = `Saved games: ${archive.count}`;
    const stamp = new Date().toISOString().slice(0, 10);
    downloadBlob(archive.blob, `openzh-saves-${stamp}.zip`);
    savesStatus.textContent = `Exported ${archive.count} saved game${archive.count === 1 ? "" : "s"}.`;
  } catch {
    savesStatus.textContent = "Could not export the saved games.";
  } finally {
    exportSaves.disabled = savedGameCount === 0;
  }
}

// ----- settings backup -----

function setSettingsBusy(busy: boolean): void {
  exportSettings.disabled = busy;
  exportEverything.disabled = busy;
  importSettings.disabled = busy;
}

function showSettingsStatus(text: string): void {
  settingsStatus.hidden = false;
  settingsStatus.textContent = text;
}

async function exportUserBackup(kind: BackupKind): Promise<void> {
  setSettingsBusy(true);
  showSettingsStatus("Preparing the ZIP…");
  try {
    const { blob, files } = await exportBackup(kind, flushUserData);
    const stamp = new Date().toISOString().slice(0, 10);
    downloadBlob(blob, `openzh-${kind}-${stamp}.zip`);
    showSettingsStatus(`Exported ${files} file${files === 1 ? "" : "s"}.`);
  } catch {
    showSettingsStatus("Could not export the settings.");
  } finally {
    setSettingsBusy(false);
  }
}

async function importUserBackup(file: File): Promise<void> {
  if (pageState === "playing" && !window.confirm("Importing restarts the game. Unsaved progress is lost. Continue?")) {
    return;
  }
  setSettingsBusy(true);
  showSettingsStatus("Importing…");
  try {
    // The running engine must not write its older files over the import.
    suspendUserDataSaves();
    const { files } = await importBackup(file);
    showSettingsStatus(`Imported ${files} file${files === 1 ? "" : "s"}. Restarting…`);
    releaseStoredArchives();
    window.location.reload();
  } catch (error) {
    resumeUserDataSaves();
    showSettingsStatus(error instanceof BackupError ? error.message : "Could not import this backup.");
    setSettingsBusy(false);
  }
}

async function deleteStoredAndReload(): Promise<void> {
  reloadConfirm.disabled = true;
  reloadCancel.disabled = true;
  // The running engine holds the archives open; hand them back before deleting.
  releaseStoredArchives();
  try {
    await clearStored();
  } catch {
    // A failed delete still reloads the page: the loader then shows what is
    // really stored instead of claiming a state the browser refused.
  }
  window.location.reload();
}

// ----- wiring -----

function wireMenu(): void {
  menuButton.addEventListener("click", () => {
    if (menu.open) closeMenu();
    else openMenu();
  });
  // A click whose target is the dialog itself is the modal backdrop.
  menu.addEventListener("click", (event) => {
    if (event.target === menu) closeMenu();
  });
  menuClose.addEventListener("click", () => closeMenu());
  // Escape closes the native dialog; this runs for every close route so focus
  // and aria-expanded always return to the button that opened it.
  menu.addEventListener("close", () => {
    menuButton.setAttribute("aria-expanded", "false");
    menuButton.focus();
  });

  about.addEventListener("click", () => openDialog(aboutDialog));
  aboutClose.addEventListener("click", () => closeDialog(aboutDialog));
  aboutDialog.addEventListener("close", () => about.focus());

  donate.addEventListener("click", () => openDialog(donateDialog));
  gameMenu.addEventListener("click", () => openGameMenu());
  donateClose.addEventListener("click", () => closeDialog(donateDialog));
  donateDialog.addEventListener("close", () => donate.focus());
  donateDialog.addEventListener("click", (event) => {
    if (event.target === donateDialog) closeDialog(donateDialog);
  });

  reload.addEventListener("click", () => showReloadConfirmation());
  reloadCancel.addEventListener("click", () => closeDialog(reloadDialog));
  reloadConfirm.addEventListener("click", () => {
    void deleteStoredAndReload();
  });

  exportSaves.addEventListener("click", () => {
    void exportSavedGames();
  });

  exportSettings.addEventListener("click", () => {
    void exportUserBackup("settings");
  });
  exportEverything.addEventListener("click", () => {
    void exportUserBackup("everything");
  });
  importSettings.addEventListener("click", () => importSettingsInput.click());
  importSettingsInput.addEventListener("change", () => {
    const file = importSettingsInput.files?.[0];
    importSettingsInput.value = "";
    if (file !== undefined) void importUserBackup(file);
  });

  fpsToggle.checked = performanceOverlay;
  fpsToggle.addEventListener("change", () => {
    performanceOverlay = fpsToggle.checked;
    writePerformanceOverlay(performanceOverlay);
    applyPerformanceOverlay();
  });
}

function wireFullscreen(): void {
  fullscreen.hidden = !canFullscreen();
  updateFullscreenButton();
  fullscreen.addEventListener("click", () => {
    enterFullscreen();
  });
  document.addEventListener("fullscreenchange", onFullscreenChange);
}

function wireInput(): void {
  zipInput.addEventListener("change", () => {
    const files = Array.from(zipInput.files ?? []);
    if (files.length === 0) return;
    void importZipFiles(files).catch(fail);
  });

  dropZone.addEventListener("dragover", (event) => {
    event.preventDefault();
    dropZone.classList.add("is-over");
  });
  dropZone.addEventListener("dragleave", () => {
    dropZone.classList.remove("is-over");
  });
  dropZone.addEventListener("drop", (event) => {
    dropZipFiles(event);
  });
  dropZone.addEventListener("click", () => {
    zipInput.click();
  });
  dropZone.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    zipInput.click();
  });

  importCancel.addEventListener("click", () => {
    importAbort?.abort();
  });

  retry.addEventListener("click", () => {
    void startEngine();
  });

  // The game plays with the right mouse button: the browser's context menu must
  // never open over the canvas, and only over the canvas.
  canvas.addEventListener("contextmenu", (event) => {
    event.preventDefault();
  });

  // The engine writes its render resolution into the canvas backing size, so a
  // change re-fits the canvas to the new aspect ratio: on the screen in
  // fullscreen (#91), in the page while windowed (#97).
  new MutationObserver(fitCanvas).observe(canvas, {
    attributes: true,
    attributeFilter: ["width", "height"],
  });
  window.addEventListener("resize", fitCanvas);
}

function wireAudio(): void {
  mute.addEventListener("click", () => {
    // The first press only asks the browser for sound; it never mutes.
    if (soundBlocked()) {
      allowSound();
      return;
    }
    soundAllowed = true;
    resumeEngineAudio();
    userMuted = !userMuted;
    writeMuted(userMuted);
    updateMuteButton();
    applyMute();
  });
  // A missed focus event also recovers on the first interaction, but only
  // when the document really reports focus (issue #186).
  const refreshOnInteraction = () => {
    if (windowFocused || !document.hasFocus()) return;
    windowFocused = true;
    applyMute();
  };
  window.addEventListener("pointerdown", refreshOnInteraction, true);
  // Any other gesture also allows sound. The volume button handles its own
  // press, so its first click is not turned into a mute.
  const allowOnGesture = (event: Event) => {
    if (event.target instanceof Node && mute.contains(event.target)) return;
    allowSound();
  };
  for (const type of ["pointerup", "keydown", "touchend"]) {
    window.addEventListener(type, allowOnGesture, true);
  }
  window.addEventListener("keydown", refreshOnInteraction, true);
  window.addEventListener("blur", () => {
    windowFocused = false;
    applyMute();
  });
  window.addEventListener("focus", () => {
    windowFocused = true;
    applyMute();
  });
  document.addEventListener("visibilitychange", () => {
    applyMute();
  });
}

// ----- boot -----

async function loadStoredAndStart(): Promise<void> {
  setState("boot");
  // Issue #162: an extra/ tree left by an older import is dead weight; remove
  // it once, before the stored summary, and never let cleanup block the page.
  try {
    await removeExtra();
  } catch {
    // Cleanup is best effort: the loader still lists and imports archives.
  }
  try {
    storedFiles = await listStored();
  } catch {
    storedFiles = [];
  }
  showStored(storedFiles);
  await refreshStorage();
  if (hasRequired(storedFiles)) {
    void startEngine();
  } else {
    status.textContent = "Awaiting game data";
    setState("no-assets");
  }
}

function boot(): void {
  userMuted = readMuted();
  performanceOverlay = readPerformanceOverlay();
  fpsToggle.checked = performanceOverlay;
  updateMuteButton();
  wireFullscreen();
  wireMenu();
  wireInput();
  wireAudio();

  if (missingFeatureNames.length > 0) {
    unsupported.textContent = `Missing browser features: ${missingFeatureNames.join(", ")}`;
    unsupported.hidden = false;
    zipInput.disabled = true;
    setState("unsupported");
    return;
  }

  void loadStoredAndStart().catch(fail);
}

boot();
