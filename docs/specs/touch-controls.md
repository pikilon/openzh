# Touch controls

Status: proposed by the owner (2026-10-19). Not yet an issue; create one and a
brief under `docs/briefs/` before implementing. Phase 1 (playable in the
browser). Size m.

## 1. Goal

A player on a touch screen can play skirmish against the AI in the browser
port, including in fullscreen, without a keyboard or mouse. Desktop behaviour
does not change.

## 2. Prior art

Checked on the web and in the owner's other project. Not verified by playing
the ports; the notes below are what the sources describe.

* **Red Line (`pikilon/red-line`, `specs/08-player-controls.md` §3.6).** The
  owner's reference for the joystick: a 120 px base with a 40 px knob, dead
  zone 0.15, pointer capture, a menu button, and touch events isolated from
  the map. This spec reuses that design and its conventions.
* **Ammaar Reshi's native Generals Zero Hour port for iPhone, iPad and Mac**
  (built on `fbraz3/GeneralsX`, reported in
  [VGTimes](https://vgtimes.com/tech-and-hardware/160158-command-conquer-generals-zero-hour-gets-native-port-for-macos-iphone.html)
  and [Generation Amiga](https://www.generationamiga.com/2026/07/23/command-conquer-generals-zero-hour-arrives-on-ios-ipados-and-macos/)).
  Reported controls: tap to select, drag box to select, two-finger pan, pinch
  zoom, long press for commands. This is the closest precedent for the same
  game; its UI details (buttons, joystick, lock modes) were not found.
* **Command & Conquer: Red Alert on iPhone**, per
  [PocketGamer](https://www.pocketgamer.com/articles/013957/r/): units are
  tapped one by one, and groups are boxed after the player activates a
  selection box first. This is the same problem as the left lock below.
* **Two-finger box select** is proposed by players for the failed Red Alert
  iOS port
  ([EA forum](https://forums.ea.com/discussions/command-and-conquer-franchise-en/suggestion-bring-red-alert-to-mobile-with-two-finger-box-select/13624253)).
  A user suggestion, not an official source. Rejected for v1 (section 6): it
  conflicts with two-finger pan.
* **Rusted Warfare** ([Droid Gamers](https://www.droidgamers.com/news/new-rts-game-for-android-rusted-warfare-has-a-lot-of-potential/))
  uses two-finger box select and a long press for a single unit.
* **Total War** ([manual](https://r2enc.totalwar.com/en/manual/single-player/0005_enc_page_help_keyboard_shortcuts))
  uses a press-and-hold like a tap, and a two-finger pinch for zoom.
* **OpenRA** offers a right-click and a classic left-click control scheme on
  desktop. No touch port was found.

Conclusion used here: one-finger tap for select; long press for the command
(what the Generals port does); latched modifier buttons for what a touch
screen cannot do with two buttons (box select, right click, add to selection);
two-finger gestures are left for later.

## 3. Scope

In: a toggle button, the overlay with three lock buttons and a mini joystick,
and the mapping from touch to the engine's mouse and keyboard input, in the
browser build, in windowed and fullscreen play.

Out: the in-game menu on touch (use the existing menu entry once it exists),
control groups (Ctrl+1..9), minimap gestures, pinch zoom, a touch keyboard,
native builds.

## 4. Controls

### 4.1 Toggle button

* A button, `#touch-toggle`, labelled "Touch" (i18n key `touch.toggle`), shown
  as an icon button in the top bar while the game plays (owner, 2026-10-19:
  the overlay over the game holds only the touch controls). Not shown in the
  launcher view before Play. Next to it, `#game-menu` sends Escape to the
  engine to open the in-game menu. The app is landscape only: the manifest
  asks for it, fullscreen locks it, and a touch screen in portrait shows a
  rotate notice.
* Pressing it shows or hides the overlay (section 4.2). Its pressed state is
  visible (`aria-pressed`).
* Default: off on a device without touch (`matchMedia("(pointer: coarse)")`
  false and `navigator.maxTouchPoints` 0), on otherwise. The last choice is
  kept in `localStorage` (per-viewer convenience only; a failed read or write
  falls back to the default).

### 4.2 Overlay

* A row of controls anchored to the bottom of the game area, drawn over the
  canvas, reading left to right: **Left lock**, **Right lock**, **Multi lock**,
  then the **mini joystick** at the right end. The three lock buttons are
  at least 48 x 48 CSS px with a text label and an icon, `aria-pressed`
  reflects the lock.
* The overlay is a DOM element inside `#screen`, the element put in browser
  fullscreen (`web/src/main.ts`). It must sit inside `#screen`, not beside it,
  or it is hidden in fullscreen.
* The overlay never covers the minimap or the top bar in the playing view on
  375 x 812 and 812 x 375 (phone portrait and landscape).
* Overlay controls are isolated: `pointerdown`, `pointerup` and `click` stop
  propagation, and `contextmenu` is prevented, so a touch on a control never
  reaches the map. Each control sets `touch-action: none`.
* The overlay is created once; its visibility and lock states change only the
  attributes they need (no DOM rebuild per frame).

### 4.3 Mini joystick

* A circle, about 120 CSS px, with a ball (knob, about 40 px) at its centre.
  Dragging the ball moves it inside the circle; it springs back to the centre
  on release.
* Output: a vector `(x, y)` with each axis in [-1, 1] (x right, y down), zero
  inside a dead zone of 0.15 of the radius. It pans the camera at the same
  speed the arrow keys use, so a full push is full speed, half is half.
* Pointer capture: the joystick keeps the pointer that started it; other
  pointers are ignored. `pointercancel` and window `blur` release it.
* The vector is sent to the engine as analog camera pan (see 5.2).

### 4.4 Lock buttons

Each lock is a latch: one tap turns it on, the next tap turns it off. Locks
are independent and can be combined. Locks are cleared when the match
restarts or the overlay is hidden.

* **Left lock.** While on, a one-finger drag on the map draws a selection box
  (left mouse drag) and the units inside it are selected when the finger
  lifts. A tap still selects one unit or building (left click).
* **Right lock.** While on, a tap on the map is a right click (move, attack,
  or the default order for the target), instead of a left click. Off by
  default.
* **Multi lock.** While on, a tap (or a box) adds to the current selection
  instead of replacing it. It sends the same modifier the engine uses for
  adding to a selection (Ctrl or Shift on desktop; the exact key is confirmed
  in the engine before implementing, section 8).

Without any lock on, a one-finger tap on the map is a left click, and a long
press (500 ms without moving more than 10 CSS px) is a right click. A
one-finger drag without a lock does nothing on the map; it does not select
and does not pan (panning is the joystick's job).

### 4.5 Locks and the joystick together

The joystick works in every lock state. Pushing it while a lock is on does not
change the lock.

## 5. Mapping to the engine

### 5.1 Map input

The engine reads SDL3 input, and the browser sends it through the wrapper. The
touch controls are translated in the wrapper (`web/src/`), into the mouse
events the engine already accepts, so the engine needs no change for taps,
drags and right clicks. The exact injection point (the bridge in
`web/src/bridge.ts` or the canvas events) is confirmed in the brief; it must
use the same coordinates the canvas uses for desktop mouse input, after the
canvas fit (`web/src/main.ts`, #80 and #97).

### 5.2 Camera pan

The joystick vector is passed to the engine as a camera pan equal to the arrow
keys. Preferred: the same key path the arrow keys use. If the engine has no
suitable entry point, a short brief decides the alternative; the joystick
does not wait for analog camera support.

### 5.3 Mouse state

The wrapper keeps the touch state machine (idle, tap pending, long press,
box drag, joystick) and emits only mouse down, move and up events with
timestamps the engine understands. A long press that moves more than 10 CSS px
becomes a drag, not a right click.

## 6. Decisions and non-goals

* Long press for the right click without a lock (Generals port precedent).
* Two-finger box select is not used: two-finger gestures are reserved for a
  later pinch zoom and pan, and the Right and Multi locks cover the same needs
  with one finger.
* The overlay is not drawn over the engine canvas in fullscreen from a second
  canvas; it is DOM inside `#screen`.

## 7. Acceptance criteria

1. The toggle button is visible in the playing view on an 812 x 375 viewport with touch emulation, and is not visible in the launcher before Play.
2. Pressing the toggle shows the overlay; pressing it again hides the overlay and clears the locks and any joystick push.
3. The overlay lies inside `#screen`, and stays visible and usable after `requestFullscreen` on `#screen`.
4. The overlay's controls are in left to right order: Left lock, Right lock, Multi lock, joystick; the joystick is the rightmost control.
5. A tap on each lock button toggles its `aria-pressed` between true and false and sends no map click.
6. With no lock on, a tap on a unit in the map selects it (left click), and a 500 ms press without movement issues a right click at that point.
7. With Left lock on, a one-finger drag over units selects exactly the units inside the box when the finger lifts.
8. With Right lock on, a tap on the map issues a right click and does not change the selection.
9. With Multi lock on, a tap on a unit adds it to the selection without clearing the others.
10. Pushing the joystick pans the camera at the arrow-key speed; the ball returns to the centre on release.
11. Touches on the overlay never select, box or order anything on the map (no change to the selection or to the units' orders).
12. Desktop mouse and keyboard behaviour is unchanged: with the overlay hidden and no touch, the same input produces the same events as before.
13. The toggle's on/off choice survives a reload; a blocked `localStorage` falls back to the default without an error in the console.

## 8. Open questions for the brief

* The exact modifier key for the Multi lock (section 4.4), confirmed in the
  engine's selection code.
* Whether the engine accepts an analog pan or only key events (section 5.2).
* Button icons and labels in English and Spanish (i18n).

## 9. Tests

* Playwright in Brave only (D-04), with touch emulation (`hasTouch`) and the
  fake engine harness in `web/tests/harness/` for the input contracts. Criteria
  1-5 and 13 need no engine. Criteria 6-12 need a fake engine that records the
  mouse and key events it receives.
* Test paths: `web/tests/touch-controls.spec.ts`. No game data in the tests
  (AGENTS.md, Local Game Data).
