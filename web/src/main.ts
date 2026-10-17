// Launcher page logic (docs/briefs/5c-launcher.md): the player picks their
// game install folder, the archives are classified and copied into OPFS, and
// the engine runs from them. The DOM element ids are the page's contract.

import { classifyArchives, REQUIRED, type GameKind, type InstallReport } from "./install";
import { storeFiles, listStored, clearStored, type StoredFile } from "./opfs-store";
import { prepareEngineOptions } from "./engine";

type Page = Window & typeof globalThis & { __zhwpLog?: string[] };

function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (element === null) throw new Error(`missing #${id}`);
  return element as T;
}

const input = byId<HTMLInputElement>("folder-input");
const status = byId<HTMLElement>("status");
const progress = byId<HTMLProgressElement>("import-progress");
const summary = byId<HTMLElement>("stored-summary");
const play = byId<HTMLButtonElement>("play");
const clear = byId<HTMLButtonElement>("clear");
const canvas = byId<HTMLCanvasElement>("canvas");
const picker = byId<HTMLElement>("picker");

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

function showStored(stored: StoredFile[]): void {
  summary.textContent = `Stored: ${stored.length} archives`;
  play.disabled = !hasRequired(stored);
}

function fail(message: unknown): void {
  status.textContent = String(message instanceof Error ? message.message : message);
  hideProgress();
}

async function refresh(): Promise<void> {
  showStored(await listStored());
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

async function importFolder(files: FileList): Promise<void> {
  const choice = classifyPicked(files);
  if (choice === null) return;
  const { picked, report } = choice;
  if (report.missing.length > 0) {
    showStored(await listStored());
    return;
  }
  const chosen = new Map(picked.map((file) => [pathOf(file), file]));
  await storeFiles(
    report.archives.map((entry) => ({
      kind: entry.kind as GameKind,
      name: entry.name,
      file: chosen.get(entry.path) as Blob,
    })),
    (doneBytes, totalBytes) => showProgress(doneBytes, totalBytes),
  );
  hideProgress();
  status.textContent = "Ready";
  await refresh();
}

async function playNow(): Promise<void> {
  play.disabled = true;
  input.disabled = true;
  canvas.hidden = false;
  canvas.focus();
  picker.hidden = true;
  status.textContent = "Starting";
  const page = window as Page;
  page.__zhwpLog = [];
  const record = (line: string) => {
    page.__zhwpLog?.push(line);
  };
  const reportError = (message: unknown) => {
    status.textContent = `Engine failed: ${String(message ?? "unknown error")}`;
    record("[page] " + String(message ?? "unknown error"));
  };
  try {
    const module = (await import("/engine/GeneralsXZH.js")) as { default?: unknown };
    if (typeof module.default !== "function") {
      throw new Error("module /engine/GeneralsXZH.js has no default-exported factory");
    }
    const options = await prepareEngineOptions({
      canvas,
      arguments: ["-win"],
      print: record,
      printErr: record,
      onAbort: reportError,
    });
    await (module.default as (options: unknown) => Promise<unknown>)(options);
    status.textContent = "Ready";
  } catch (error) {
    reportError(error instanceof Error ? error.message : String(error));
  }
}

async function clearAll(): Promise<void> {
  // The picker controls stay enabled while the store is cleared: a folder
  // picked during those milliseconds would otherwise be classified into a
  // stale, empty summary.
  play.disabled = true;
  await clearStored();
  status.textContent = "";
  hideProgress();
  await refresh();
}

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

void refresh().catch(fail);
