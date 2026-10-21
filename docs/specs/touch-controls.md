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

In: a toggle button, the overlay with the game-menu button, three lock buttons,
a fullscreen toggle, a mini joystick and a vertical zoom bar with tick marks on
the right edge, and the mapping from touch to the engine's mouse and keyboard
input, in the browser build, in windowed and fullscreen play.
fullscreen play.

Out: control groups (Ctrl+1..9), minimap gestures, pinch zoom, a touch keyboard,
native builds.

## 4. Controls

### 4.1 Toggle button

* A button, `#touch-toggle`, labelled "Touch" (i18n key `touch.toggle`), shown
  as an icon button in the top bar while the game plays (owner, 2026-10-19:
  the overlay over the game holds only the touch controls). Not shown in the
  launcher view before Play. The pause/menu action is not in the top bar: it
  is the first control of the touch column (section 4.2); the keyboard Esc
  still opens the in-game menu on desktop. The app is landscape only: the
  manifest asks for it, fullscreen locks it, and a touch screen in portrait
  shows a rotate notice.
* Pressing it shows or hides the overlay (section 4.2). Its pressed state is
  visible (`aria-pressed`).
* Default: off on a device without touch (`matchMedia("(pointer: coarse)")`
  false and `navigator.maxTouchPoints` 0), on otherwise. The last choice is
  kept in `localStorage` (per-viewer convenience only; a failed read or write
  falls back to the default).

### 4.2 Overlay

* Controls anchored to the bottom of the game area, drawn over the canvas: the
  game menu, the **Left lock**, **Right lock** and **Multi lock**, and the
  fullscreen toggle, stacked in a column at the bottom-left corner, the
  **zoom bar** (section 4.7) along the right edge above the joystick, and the
  **mini joystick** at the very bottom-right corner. The order top to bottom is
  game menu, Left, Right, Multi, fullscreen toggle.
* Every column button is rendered at 70 % of its 56 x 54 CSS px base
  (39.2 x 37.8 CSS px), owner's choice of 2026-10-20; icons and the text label
  shrink with it. The label stays visible: Left, Right and Multi carry a mouse
  icon (the pressed button of the mouse is filled; Multi is a mouse with a
  plus), `aria-pressed` reflects the lock, the game menu carries the pause
  icon, and the fullscreen toggle the four-corner icon.
* `#touch-fullscreen` is the last column control: windowed it reads "Enter
  fullscreen" and enters; while `#screen` is the fullscreen element it reads
  "Exit fullscreen" and leaves. The top-bar `#fullscreen` stays visible too
  while the overlay is shown, so switching touch controls never hides or moves
  the fullscreen action (owner's follow-up, 2026-10-20): the column adds a
  thumb-reachable duplicate and both controls follow `fullscreenchange`.
* The overlay is a DOM element inside `#screen`, the element put in browser
  fullscreen (`web/src/main.ts`). It must sit inside `#screen`, not beside it,
  or it is hidden in fullscreen. The zoom bar is a sibling inside `#screen`,
  because it spans the height of the game view, and follows the overlay's
  visibility.
* The overlay never covers the top bar. The joystick sits over the bottom-right
  corner of the view (owner's choice, 2026-10-20) and is small to stay out of the
  way. It keeps a 60 CSS px right margin so the joystick and its landing ring
  stay left of the zoom bar; while the bar is shown, the dock is clamped to the
  left of the bar even when the player drags it.
* Overlay controls are isolated: `pointerdown`, `pointerup` and `click` stop
  propagation, and `contextmenu` is prevented, so a touch on a control never
  reaches the map. Each control sets `touch-action: none`.
* The overlay is created once; its visibility and lock states change only the
  attributes they need (no DOM rebuild per frame).

### 4.3 Mini joystick

* A 48 CSS px touch area (the landing zone extends 16 px beyond it) with a
  16 px ball (knob) at its centre. At rest only the ball is visible: the outer
  ring is collapsed onto it. While touched the ring opens to the full 48 px.
  Dragging the ball moves it inside the ring; it springs back to the centre
  on release.
* Output: a vector `(x, y)` with each axis in [-1, 1] (x right, y down), zero
  inside a dead zone of 0.15 of the radius. It pans the camera at the same
  speed the arrow keys use, so a full push is full speed, half is half.
* Pointer capture: the joystick keeps the pointer that started it; other
  pointers are ignored. `pointercancel` and window `blur` release it.
* The vector is sent to the engine as analog camera pan (see 5.2).
* During a scripted cinematic the engine reports an active letterbox; the
  joystick is disabled until it ends: it dims, sets `aria-disabled="true"`,
  ignores pointers, releases an active drag and sends no pan. It re-enables
  within 200 ms of the letterbox clearing.

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

### 4.6 Column actions

* The game menu is the first column control and sends the same Escape
  `keydown` + `keyup` to the engine as before (owner, 2026-10-20: it moves out
  of the top bar into the touch column). It is reachable only while the overlay
  is shown; on desktop the keyboard Esc still opens the menu.
* The fullscreen toggle is the last column control. It calls
  `requestFullscreen` on `#screen` while windowed and `exitFullscreen` while
  fullscreen, sends no key or pointer event to the engine, and switches its
  label with `fullscreenchange`, including a browser Esc. It repeats the
  top-bar action at thumb reach; the top-bar `#fullscreen` stays visible as
  well (owner's follow-up, 2026-10-20).

### 4.7 Zoom bar

* `#touch-zoom` is a sibling of `#touch-controls` inside `#screen`, hidden while
  the overlay is hidden. It is a 30 CSS px wide rail on the right edge (with the
  same 6 px safe area as the overlay), from 8 px below the top of `#screen` to
  127 px above the overlay's bottom plus its safe area, so it ends above the
  joystick's grip and never intersects the joystick or its 16 px landing ring.
* The rail carries nine tick marks (`.touch-zoom-tick`), the middle one longer,
  and a thumb (`#touch-zoom-thumb`) at its centre. The thumb follows the finger
  during a drag, clamped inside the rail, and returns to the centre on release.
* Only touch and pen pointers start a drag (owner's request, 2026-10-20: no
  mixing with scrolling). `pointerdown` captures the pointer and cancels the
  event; vertical movement up zooms in and down zooms out; 4 CSS px is one
  retail wheel notch. The page synthesises a `WheelEvent` on `#canvas` with
  `deltaMode: 0` and `deltaY = -notches * 100`, which is the engine's existing
  wheel path. A tap without movement does not zoom.
* The bar is relative: its displacement is a zoom delta, not an absolute
  camera position, because the engine exposes no zoom value to the page. An
  absolute fader and pinch are later work.
* A touch on the bar produces no pointer event on the canvas, no camera pan and
  no page scroll. The bar cancels its pointer events, stops their propagation
  and sets `touch-action: none`.

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

### 5.4 Camera zoom

The zoom bar synthesises a `WheelEvent` on the canvas with `deltaMode: 0` and
`deltaY = -notches * 100`; SDL3 and `LookAtXlat.cpp` already translate a wheel
event into `TheTacticalView->userZoom`, so the engine needs no change and no
rebuild. Negative `deltaY` is zoom in, positive is zoom out.

## 6. Decisions and non-goals

* Long press for the right click without a lock (Generals port precedent).
* Two-finger box select is not used: two-finger gestures are reserved for a
  later pinch zoom and pan, and the Right and Multi locks cover the same needs
  with one finger.
* The overlay is not drawn over the engine canvas in fullscreen from a second
  canvas; it is DOM inside `#screen`.
* The zoom bar is relative, not an absolute fader: the engine has no getter for
  the camera zoom, and an absolute thumb would drift from the real camera.
  Absolute zoom and pinch are later work.

## 7. Acceptance criteria

1. The toggle button is visible in the playing view on an 812 x 375 viewport with touch emulation, and is not visible in the launcher before Play.
2. Pressing the toggle shows the overlay; pressing it again hides the overlay and clears the locks and any joystick push.
3. The overlay lies inside `#screen`, and stays visible and usable after `requestFullscreen` on `#screen`.
4. The column runs top to bottom (game menu, Left, Right, Multi, fullscreen toggle) at the left edge, each button is 39.2 x 37.8 CSS px on the 812 x 375 viewport (70 % of its 56 x 54 base), and the joystick is at the bottom-right corner.
5. A tap on each lock button toggles its `aria-pressed` between true and false and sends no map click.
6. With no lock on, a tap on a unit in the map selects it (left click), and a 500 ms press without movement issues a right click at that point.
7. With Left lock on, a one-finger drag over units selects exactly the units inside the box when the finger lifts.
8. With Right lock on, a tap on the map issues a right click and does not change the selection.
9. With Multi lock on, a tap on a unit adds it to the selection without clearing the others.
10. Pushing the joystick pans the camera at the arrow-key speed; the ball returns to the centre on release.
11. Touches on the overlay never select, box or order anything on the map (no change to the selection or to the units' orders).
12. Desktop mouse and keyboard behaviour is unchanged: with the overlay hidden and no touch, the same input produces the same events as before.
13. The toggle's on/off choice survives a reload; a blocked `localStorage` falls back to the default without an error in the console.
14. `#game-menu` is not in the top bar; while the overlay is shown, clicking the first column control sends Escape down and up to the engine, and hiding the overlay hides it.
15. `#touch-fullscreen` is the last column control: windowed it reads "Enter fullscreen" and enters fullscreen, in fullscreen it reads "Exit fullscreen" and leaves, and hiding the overlay hides it.
16. While the overlay is shown the top-bar `#fullscreen` stays visible next to `#touch-fullscreen`; hiding the overlay hides only the column, and a desktop context keeps the top-bar button while `#touch-fullscreen` stays hidden with the overlay.
17. While the engine reports a cinematic, the joystick sends no pan call, ignores a drag and shows `aria-disabled="true"`; when the cinematic ends it pans again.
18. The zoom bar is visible on the right edge inside `#screen` while the overlay is shown, at least 140 CSS px tall on an 812 x 375 viewport, and hidden with the overlay.
19. The bar shows nine tick marks and a centred thumb; dragging up zooms in, dragging down zooms out, and the thumb returns to the centre on release.
20. The bar never intersects the joystick, its grip or its landing ring, including after the joystick is dragged to its rightmost position.
21. A touch on the bar sends no pointer event to the canvas, pans no camera and scrolls no page; the page dispatches the zoom as a wheel event on the canvas.

## 8. Open questions for the brief

* The exact modifier key for the Multi lock (section 4.4), confirmed in the
  engine's selection code.
* Whether the engine accepts an analog pan or only key events (section 5.2).
* Button icons and labels in English and Spanish (i18n).

## 9. Tests

* Playwright in Brave only (D-04), with touch emulation (`hasTouch`) and the
  fake engine harness in `web/tests/harness/` for the input contracts. Criteria
  1-5 and 13 need no engine. Criteria 6-12, 14-16 and 17-20 need a fake engine
  that records the mouse, key, wheel and pan events it receives.
* Test paths: `web/tests/touch-controls.spec.ts`,
  `web/tests/launcher-topbar-game.spec.ts` and `web/tests/zoom-bar.spec.ts`. No
  game data in the tests (AGENTS.md, Local Game Data).
