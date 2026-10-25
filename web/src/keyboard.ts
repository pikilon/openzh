// The browser port's keyboard bindings (issue #202). The four camera keys are
// extras on top of the engine's arrow keys; the two command keys are the
// original shortcuts that used to occupy W and S. Keeping them in one object
// lets the menu move W/S without ever leaving the game commands unbound.
//
// Values are `KeyboardEvent.code` names ("KeyW", "Digit1"), the layout-
// independent physical key. Only letters and the ten top-row digits are
// accepted, matching the scancode table in SDL3Keyboard.cpp. The arrow keys
// stay hardcoded in LookAtXlat and are deliberately not assignable here.

export type KeySlot =
  | "cameraUp"
  | "cameraDown"
  | "cameraLeft"
  | "cameraRight"
  | "selectAllAircraft"
  | "stop";

export interface KeyBindings {
  cameraUp: string;
  cameraDown: string;
  cameraLeft: string;
  cameraRight: string;
  selectAllAircraft: string;
  stop: string;
}

export interface KeySlotInfo {
  id: KeySlot;
  label: string;
  group: "camera" | "commands";
}

export const KEY_SLOTS: readonly KeySlotInfo[] = [
  { id: "cameraUp", label: "Move up", group: "camera" },
  { id: "cameraDown", label: "Move down", group: "camera" },
  { id: "cameraLeft", label: "Move left", group: "camera" },
  { id: "cameraRight", label: "Move right", group: "camera" },
  { id: "selectAllAircraft", label: "Select all aircraft", group: "commands" },
  { id: "stop", label: "Stop", group: "commands" },
];

export const KEYBOARD_STORAGE_KEY = "openzh.keyboard";

// W/S/A/D move the camera. The original SELECT_ALL_AIRCRAFT (W) and STOP (S)
// move to Y/Z, both free in the shipped Zero Hour CommandMap.
export const DEFAULT_KEY_BINDINGS: Readonly<KeyBindings> = {
  cameraUp: "KeyW",
  cameraDown: "KeyS",
  cameraLeft: "KeyA",
  cameraRight: "KeyD",
  selectAllAircraft: "KeyY",
  stop: "KeyZ",
};

const LETTER = /^Key[A-Z]$/;
const DIGIT = /^Digit[0-9]$/;

export function isSupportedKeyCode(code: string): boolean {
  return LETTER.test(code) || DIGIT.test(code);
}

// The label on the key cap. The port labels physical positions the US way,
// the same way the engine's DirectInput scancodes are named.
export function displayKey(code: string): string {
  if (LETTER.test(code)) return code.slice(3);
  if (DIGIT.test(code)) return code.slice(5);
  return "?";
}

// SDL scancodes are USB HID usage codes: A-Z are 4-29, 1-9 are 30-38 and 0 is
// 39. The engine maps them with SDL3Keyboard::translateScanCodeToKeyVal.
export function scancodeForKeyCode(code: string): number | null {
  if (LETTER.test(code)) return 4 + (code.charCodeAt(3) - 65);
  if (DIGIT.test(code)) {
    const digit = Number(code.slice(5));
    return digit === 0 ? 39 : 29 + digit;
  }
  return null;
}

export function scancodesForEngine(bindings: KeyBindings): [number, number, number, number, number, number] | null {
  const codes = [bindings.cameraUp, bindings.cameraDown, bindings.cameraLeft, bindings.cameraRight, bindings.selectAllAircraft, bindings.stop];
  const values: number[] = [];
  for (const code of codes) {
    const scancode = scancodeForKeyCode(code);
    if (scancode === null) return null;
    values.push(scancode);
  }
  return values as [number, number, number, number, number, number];
}

// The other slot already using `code`, or null. Reset and the capture UI use
// this so no two actions share a physical key.
export function duplicateSlot(bindings: KeyBindings, slot: KeySlot, code: string): KeySlot | null {
  for (const other of KEY_SLOTS) {
    if (other.id !== slot && bindings[other.id] === code) return other.id;
  }
  return null;
}

function copyDefaults(): KeyBindings {
  return { ...DEFAULT_KEY_BINDINGS };
}

function parseBindings(value: unknown): KeyBindings | null {
  if (value === null || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const seen = new Set<string>();
  for (const slot of KEY_SLOTS) {
    const code = record[slot.id];
    if (typeof code !== "string" || !isSupportedKeyCode(code) || seen.has(code)) return null;
    seen.add(code);
  }
  return {
    cameraUp: record.cameraUp as string,
    cameraDown: record.cameraDown as string,
    cameraLeft: record.cameraLeft as string,
    cameraRight: record.cameraRight as string,
    selectAllAircraft: record.selectAllAircraft as string,
    stop: record.stop as string,
  };
}

// A missing, damaged or duplicate set falls back to the defaults: a half-read
// keymap is worse than the shipped one, and the file can be edited by hand.
export function readKeyBindings(): KeyBindings {
  try {
    const raw = window.localStorage.getItem(KEYBOARD_STORAGE_KEY);
    if (raw === null) return copyDefaults();
    return parseBindings(JSON.parse(raw)) ?? copyDefaults();
  } catch {
    // No Storage or invalid JSON: the game still starts with the defaults.
    return copyDefaults();
  }
}

export function writeKeyBindings(bindings: KeyBindings): void {
  try {
    window.localStorage.setItem(KEYBOARD_STORAGE_KEY, JSON.stringify(bindings));
  } catch {
    // The choice still applies to this page; only persistence is lost.
  }
}
