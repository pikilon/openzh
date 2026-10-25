// The Keyboard dialog behind the hamburger (issue #202). It edits the six
// browser-side bindings, rejects duplicates and unsupported keys, and hands
// every accepted set to the page, which stores it and tells the engine.

import {
  DEFAULT_KEY_BINDINGS,
  KEY_SLOTS,
  displayKey,
  duplicateSlot,
  isSupportedKeyCode,
  writeKeyBindings,
  type KeyBindings,
  type KeySlot,
} from "./keyboard";
import { closeDialog, openDialog } from "./shell";

export interface KeyboardSettingsOptions {
  dialog: HTMLDialogElement;
  openButton: HTMLButtonElement;
  closeButton: HTMLButtonElement;
  resetButton: HTMLButtonElement;
  status: HTMLElement;
  initial: KeyBindings;
  onChange: (bindings: KeyBindings) => void;
}

export interface KeyboardSettings {
  open(): void;
  setBindings(bindings: KeyBindings): void;
  getBindings(): KeyBindings;
}

function copy(bindings: KeyBindings): KeyBindings {
  return { ...bindings };
}

export function createKeyboardSettings(options: KeyboardSettingsOptions): KeyboardSettings {
  const { dialog, openButton, closeButton, resetButton, status } = options;
  let bindings = copy(options.initial);
  let capturing: KeySlot | null = null;

  const buttons = new Map<KeySlot, HTMLButtonElement>();
  for (const slot of KEY_SLOTS) {
    const button = dialog.querySelector<HTMLButtonElement>(`[data-key-slot="${slot.id}"]`);
    if (button === null) throw new Error(`missing keyboard button for ${slot.id}`);
    buttons.set(slot.id, button);
    button.addEventListener("click", () => beginCapture(slot.id));
  }

  function clearStatus(): void {
    status.textContent = "";
    status.hidden = true;
  }

  function showStatus(text: string): void {
    status.textContent = text;
    status.hidden = false;
  }

  function render(): void {
    for (const slot of KEY_SLOTS) {
      const button = buttons.get(slot.id);
      if (button === undefined) continue;
      const active = capturing === slot.id;
      button.textContent = active ? "Press a key…" : displayKey(bindings[slot.id]);
      button.classList.toggle("is-capturing", active);
      button.setAttribute(
        "aria-label",
        active ? `Press a key for ${slot.label}` : `Change ${slot.label}, current ${displayKey(bindings[slot.id])}`,
      );
    }
  }

  function beginCapture(slot: KeySlot): void {
    capturing = slot;
    clearStatus();
    render();
    buttons.get(slot)?.focus();
  }

  function cancelCapture(): void {
    if (capturing === null) return;
    capturing = null;
    render();
  }

  function commit(code: string): void {
    if (capturing === null) return;
    const slot = capturing;
    const other = duplicateSlot(bindings, slot, code);
    if (other !== null) {
      const label = KEY_SLOTS.find((candidate) => candidate.id === other)?.label ?? other;
      showStatus(`${displayKey(code)} is already assigned to ${label}.`);
      return;
    }
    bindings = { ...bindings, [slot]: code };
    writeKeyBindings(bindings);
    options.onChange(copy(bindings));
    capturing = null;
    render();
    showStatus(`${displayKey(code)} saved for ${KEY_SLOTS.find((candidate) => candidate.id === slot)?.label ?? slot}.`);
    buttons.get(slot)?.focus();
  }

  function isModifierKey(event: KeyboardEvent): boolean {
    return event.key === "Shift" || event.key === "Control" || event.key === "Alt" || event.key === "Meta";
  }

  dialog.addEventListener(
    "keydown",
    (event) => {
      if (capturing === null) return;
      if (event.key === "Tab") {
        // Let focus move away; the next click can start a new capture.
        capturing = null;
        render();
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        capturing = null;
        render();
        clearStatus();
        return;
      }
      if (isModifierKey(event)) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (event.ctrlKey || event.altKey || event.metaKey) {
        event.preventDefault();
        event.stopPropagation();
        showStatus("Press the key without Ctrl, Alt or Command.");
        return;
      }
      if (event.repeat) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (!isSupportedKeyCode(event.code)) {
        event.preventDefault();
        event.stopPropagation();
        showStatus("Use a letter or a top-row number (A-Z, 0-9).");
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      commit(event.code);
    },
    true,
  );

  dialog.addEventListener("cancel", (event) => {
    if (capturing === null) return;
    event.preventDefault();
    capturing = null;
    render();
    clearStatus();
  });

  dialog.addEventListener("close", () => {
    capturing = null;
    clearStatus();
    render();
    openButton.focus();
  });

  render();

  closeButton.addEventListener("click", () => closeDialog(dialog));
  resetButton.addEventListener("click", () => {
    bindings = { ...DEFAULT_KEY_BINDINGS };
    writeKeyBindings(bindings);
    options.onChange(copy(bindings));
    capturing = null;
    render();
    showStatus("Defaults restored.");
  });

  return {
    open(): void {
      capturing = null;
      clearStatus();
      render();
      openDialog(dialog);
      buttons.get("cameraUp")?.focus();
    },
    setBindings(next: KeyBindings): void {
      bindings = copy(next);
      capturing = null;
      render();
    },
    getBindings(): KeyBindings {
      return copy(bindings);
    },
  };
}
