# 202: Keyboard menu for the camera and the moved W/S shortcuts

Issue #202. Phase 1. Size m. Owner's request (chat, 2026-10-25): map the
camera keys from a web menu inside the hamburger, keep the mappings with the
exported preferences, and move the original W/S shortcuts somewhere else by
default so plain WASD can scroll the map.

## Goal

The player can open **Keyboard** from the hamburger and assign the six keys the
browser port adds on top of the original game: four camera keys (default
W, S, A, D) and the two original shortcuts that occupied W and S (Select all
aircraft and Stop, default Y and Z). The arrow keys keep scrolling as before.
The six bindings are saved in the browser, exported/imported with the settings,
and applied to the running engine without a reload.

## Read first

* `Core/GameEngine/Source/GameClient/MessageStream/LookAtXlat.cpp` and
  `Core/GameEngine/Include/GameClient/LookAtXlat.h`: the arrow-key switch and
  the scroll state.
* `GeneralsMD/Code/GameEngineDevice/Source/SDL3GameEngine.cpp`: the existing
  `_GeneralsX*` bridge functions and their return convention.
* `GeneralsMD/Code/GameEngineDevice/Include/SDL3Device/GameClient/SDL3Keyboard.h`
  and its `.cpp`: `translateScanCodeToKeyVal`, the SDL scancode to
  `KeyDefType` mapping the bridge reuses.
* `Core/GameEngine/Include/GameClient/MetaEvent.h` and
  `Core/GameEngine/Source/GameClient/MessageStream/MetaEvent.cpp`: the
  `MetaMapRec` fields and the default `SELECT_ALL_AIRCRAFT` / `STOP` entries.
* `web/src/main.ts`: `EngineModule`, `startEngine` and `keepKeysInDialogs`.
* `web/app/index.html`, `web/app/shell.css`: the hamburger sections and the
  centred `.dialog-panel` style.
* `web/src/user-backup.ts`: `PORTABLE_PREFERENCE_KEYS` and `launcher.json`.
* `web/tests/launcher-debug-overlay.spec.ts` and
  `web/tests/harness/overlay/records.js`: the recording fake-engine pattern.
* `web/tests/settings-backup.spec.ts`: the export/import assertions.

## Contract

### Defaults

The defaults are the keys the port ships with:

| Slot | Label | Default |
| --- | --- | --- |
| `cameraUp` | Move up | `KeyW` |
| `cameraDown` | Move down | `KeyS` |
| `cameraLeft` | Move left | `KeyA` |
| `cameraRight` | Move right | `KeyD` |
| `selectAllAircraft` | Select all aircraft | `KeyY` |
| `stop` | Stop | `KeyZ` |

`KeyW`/`KeyS` are therefore free for the camera by default: the original
`SELECT_ALL_AIRCRAFT` and `STOP` commands are rebound to Y and Z. The menu
shows the two moved commands, so the player can see where they went and can
change them (or put them back on W/S after moving the camera).

### Storage

One localStorage key, `openzh.keyboard`, holds a JSON object:

```json
{
  "cameraUp": "KeyW",
  "cameraDown": "KeyS",
  "cameraLeft": "KeyA",
  "cameraRight": "KeyD",
  "selectAllAircraft": "KeyY",
  "stop": "KeyZ"
}
```

Values are `KeyboardEvent.code` names. Only the 26 letter codes (`KeyA`...
`KeyZ`) and the ten top-row digit codes (`Digit0`...`Digit9`) are accepted.
A missing, damaged or duplicate set falls back to the defaults. The value is
written on every accepted assignment and on Reset.

`openzh.keyboard` joins `PORTABLE_PREFERENCE_KEYS`, so `launcher.json` in the
settings ZIP carries it and an import restores it. An older backup without the
key leaves the browser's current bindings in place, like the mute choice.

### Menu

* A **Keyboard** section in `#menu` with a `#keyboard-settings` button. It
  opens `#keyboard-dialog`, a native modal dialog like the other launcher
  dialogs.
* The dialog lists the four camera rows and the two moved-shortcut rows. Each
  row shows its current key in a `button[data-key-slot]`; clicking one enters
  capture mode (label "Press a key…").
* In capture mode a keydown assigns the key and stops the event; Escape
  cancels capture but does **not** close the dialog; Tab cancels capture and
  keeps normal focus behaviour. Ctrl/Alt/Command combinations are refused
  with a status line. An unsupported key or a duplicate of another slot is
  refused with a status line and capture stays active.
* `#keyboard-reset` restores the six defaults. `#keyboard-close` (Done) closes
  the dialog and returns focus to `#keyboard-settings`. Escape closes the
  dialog when not capturing.
* The dialog's key events never reach the engine: it is a `<dialog>`, which
  `keepKeysInDialogs` already covers.
* The hint says that the arrow keys always move the camera and that the two
  game shortcuts were moved.

### Engine bridge

`GeneralsXSetKeyMap(Int up, Int down, Int left, Int right, Int selectAll, Int stop)`
is a new `EMSCRIPTEN_KEEPALIVE` export in `SDL3GameEngine.cpp`. The six
arguments are SDL scancodes. It:

1. Converts each scancode with
   `SDL3Keyboard::translateScanCodeToKeyVal`; returns 0 if any is
   `KEY_NONE` or the translator/meta map is not ready.
2. Calls a new `LookAtTranslator::setCameraKeys`, which stores four extra keys
   and clears the held scroll state.
3. Finds `MSG_META_SELECT_ALL_AIRCRAFT` and `MSG_META_STOP` in `TheMetaMap` and
   sets `m_key`, `m_modState = NONE` and `m_transition = DOWN`.
4. Returns 1.

`translateScanCodeToKeyVal` becomes public and static (it uses no instance
state); no behaviour changes.

In `LookAtXlat::translateGameMessage`, a raw key first checks the four arrow
keys (unchanged), then the four extra camera keys. The arrow keys always win if
the player assigns an arrow code as an extra key (the menu only offers letters
and digits, so this is only a defensive fallback).

### Page

`main.ts` reads `readKeyBindings()` at boot. After the engine factory resolves
it calls `_GeneralsXSetKeyMap` with the six scancodes, before `data-state`
becomes `playing`. Every accepted assignment and Reset calls it again on the
live engine. If the export is missing (an older engine or a fake), the page
ignores it without an error or a rejected promise.

## Acceptance criteria

1. The hamburger shows a Keyboard entry; clicking `#keyboard-settings` opens
   `#keyboard-dialog` with the six default labels W, S, A, D, Y, Z.
2. On the automatic engine start the recording fake receives one call with
   scancodes `[26, 22, 4, 7, 28, 29]` (W, S, A, D, Y, Z).
3. Clicking the Move up binding and pressing `I` shows `I`, stores
   `"cameraUp": "KeyI"` in `openzh.keyboard`, and sends `[12, 22, 4, 7, 28, 29]`
   to the engine.
4. Assigning a key already used by another slot (for example S on Move up)
   leaves the bindings unchanged, shows a duplicate message and sends no
   engine call.
5. Assigning an unsupported key (for example ArrowUp) or a Ctrl/Alt/Command
   combination is refused with a status message and changes nothing.
6. Escape during capture cancels capture and leaves the dialog open; a second
   Escape closes it.
7. Reset restores W, S, A, D, Y, Z, stores the defaults and sends them to the
   engine.
8. A reload applies the stored bindings to the new engine object and shows
   them in the dialog.
9. `#export-settings` puts `openzh.keyboard` in `launcher.json`; importing a
   backup with that key restores it, and the page applies it after reload.
10. A fake engine without `_GeneralsXSetKeyMap` keeps playing with no page
    error and no rejected promise.
11. The existing launcher, touch and settings-backup tests still pass.

## Test paths

* `web/tests/launcher-keyboard.spec.ts` (new)
* `web/tests/harness/keyboard/records.js` (new)
* `web/tests/settings-backup.spec.ts` (extend)
* `web/tests/harness/keyboard/no-export.js` (new)

## Allowed paths

* `Core/GameEngine/Include/GameClient/LookAtXlat.h`
* `Core/GameEngine/Source/GameClient/MessageStream/LookAtXlat.cpp`
* `GeneralsMD/Code/GameEngineDevice/Include/SDL3Device/GameClient/SDL3Keyboard.h`
* `GeneralsMD/Code/GameEngineDevice/Source/SDL3Device/GameClient/SDL3Keyboard.cpp`
* `GeneralsMD/Code/GameEngineDevice/Source/SDL3GameEngine.cpp`
* `web/app/index.html`
* `web/app/shell.css`
* `web/src/keyboard.ts` (new)
* `web/src/keyboard-ui.ts` (new)
* `web/src/main.ts`
* `web/src/user-backup.ts`
* `web/tests/launcher-keyboard.spec.ts` (new)
* `web/tests/harness/keyboard/records.js` (new)
* `web/tests/harness/keyboard/no-export.js` (new)
* `web/tests/settings-backup.spec.ts`
* `docs/briefs/202-keyboard-menu.md`
* `docs/porting-notes.md`

## Check command

```sh
scripts/build-webgpu.sh
cd web && npx playwright test tests/launcher-keyboard.spec.ts tests/settings-backup.spec.ts tests/launcher-menu.spec.ts
```

On HEAD the new spec fails: there is no `#keyboard-settings`, no
`openzh.keyboard` storage and no `_GeneralsXSetKeyMap` export.
