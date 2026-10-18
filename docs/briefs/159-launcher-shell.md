# 159: Launcher: game-styled shell, auto-start and hamburger menu

Issue #159. Phase 1. Size m. Owner request 2026-10-18: the main web page is
black and ugly, the text above the game is too tall, and the game should start
by itself when its data is already stored. The page must adopt the visual
language of the game's own menus — deep navy, blue glow, angular panels — with
the title, fullscreen, mute and a hamburger menu as the only top bar. The game
window then gets all the space below it.

The attached Zero Hour screenshot is a visual reference only. No EA asset,
logo, artwork, font or trademark goes into this repository or the page
(D-07): the name stays **OpenZH** and the look is CSS and inline SVG.

## Goal

Replace the launcher with an OpenZH command-console shell: a 56 px top bar
with the title and three icon buttons, auto-start of the engine when the
required archives are stored, a CSS-only ZIP loader when they are not, and a
modal menu that holds a destructive "Reload game data" action and a persisted
performance-overlay (FPS) toggle.

## Read first

* `web/app/index.html`: the current launcher markup and inline styles.
* `web/src/main.ts`: the ZIP import flow, `refresh()`, `playNow()`,
  `fitWindowedCanvas()`, fullscreen, mute and `__zhwpLog`/`__zhwpDone`.
* `web/src/engine.ts`: `prepareEngineOptions` and the `module` query parameter.
* `web/src/features.ts`, `web/src/install.ts`, `web/src/opfs-store.ts`,
  `web/src/zip-import.ts`, `web/src/storage.ts`: the behaviour that must keep
  working.
* `web/tests/launcher*.spec.ts` and `web/tests/helpers/install-zip.ts`: the
  existing contracts and the synthetic install.
* `docs/briefs/91-fullscreen-launch.md`, `docs/briefs/97-playing-layout.md`,
  `docs/briefs/99-mute-unfocused.md`, `docs/briefs/133-zip-only-loading.md`.
* `GeneralsMD/Code/GameEngineDevice/Source/SDL3GameEngine.cpp`: the existing
  `GeneralsXSetAudioMuted` export and the includes.
* `GeneralsMD/Code/GameEngine/Include/GameClient/InGameUI.h`: the refresh
  methods and the debug-font fields (`m_renderFpsPointSize`,
  `m_networkLatencyPointSize`, `m_systemTimePointSize`, `m_gameTimePointSize`).
* `GeneralsMD/Code/GameEngine/Source/Common/GlobalData.cpp`: the four
  `*FontSize` defaults are 8.

## Contract

### State machine

`document.body` always carries `data-state` with exactly one of:
`boot`, `no-assets`, `importing`, `starting`, `playing`, `error`,
`unsupported`.

* `boot` while storage is read for the first time.
* `no-assets` when the required archives are not all stored.
* `importing` while ZIPs are copied.
* `starting` from the moment the engine factory is invoked until it resolves
  or rejects.
* `playing` after the factory resolves.
* `error` after a failed engine start.
* `unsupported` when `missingFeatures()` is non-empty.

Only one engine start may be in flight at a time, including the automatic one.
The page keeps `window.__zhwpLog` and `window.__zhwpDone` exactly as today so
the existing error and replay tests keep reading them.

### Top bar

`#topbar` is the only chrome above the game: `#title` with the text `OpenZH`,
then, in order, `#fullscreen`, `#mute` and `#menu-button` as icon-only
buttons. No status text, storage text, intro paragraph or other control is in
the top bar. Height is 56 px (never more than 64 px).

* Every icon is inline SVG inside its button; no external request, no `<img>`
  and no icon font. Each button has a `title` and an `aria-label`.
* `#fullscreen` starts disabled until `#canvas` is visible and is removed
  (`hidden`) when `document.exitFullscreen`/`requestFullscreen` is missing.
  Its labels are `Enter fullscreen` and, while in fullscreen,
  `Exit fullscreen` with `aria-pressed="true"`.
* `#mute` labels are `Mute game audio` / `Unmute game audio`; it uses
  `aria-pressed` for the user's own mute choice. It stays usable before the
  engine starts, because the choice is applied when the engine resolves.
* `#menu-button` labels are `Open menu` / `Close menu`, with
  `aria-expanded="true|false"` and `aria-controls="menu"`.

### Loader (no assets)

`#loader` is a `.panel` inside `#stage`, with `#zip-input` (file input,
`accept=".zip,application/zip"`, `multiple`), a `<label for="zip-input">`
styled as the primary action, `#drop-zone`, `#import-progress`,
`#import-detail`, `#import-current`, `#import-cancel`, `#import-error`
(`role="alert"`, `data-code`), `#unsupported` (`role="alert"`), `#status`
(`role="status"`), `#storage`, `#storage-warning`, and a visually hidden
`#stored-summary` whose text is exactly `Stored: N archives`. There is no
Play button and no "Clear stored archives" button.

The loader keeps the present import semantics: dropped `.zip` files only;
`importZips` with progress and cancel; typed failures from
`describeImportError`; `navigator.storage.estimate()` and the quota warning;
`persist()` requested once per import. The text is short and the base font is
14 px; labels are 11-12 px with letter spacing. The loader explains that the
files stay on this computer and are never uploaded.

### Auto-start

On load, after `listStored()`, if every name in `REQUIRED.zh` and
`REQUIRED.generals` is present and no feature is missing, the page starts the
engine automatically; the player never presses Play. The same happens after a
successful ZIP import. The engine URL is the `module` query parameter when
present, otherwise `/engine/GeneralsXZH.js`. A second call while `starting` or
`playing` is a no-op.

While starting, `#loading` is visible and `#loader`/`#canvas` are not; on
success `data-state="playing"`, `#canvas` is visible and focused, the loader
and loading overlay are hidden. On failure `data-state="error"`, `#loading` is
hidden and `#error-panel` shows `#engine-error` with the message and `#retry`.
`#retry` clears the error state and starts the engine again from the stored
archives (the same automatic start path); the fake engine sees a second
factory call.

### Menu

`#menu` is a native `<dialog>` styled as a right-side `.panel` drawer, shown
with `showModal()`. It closes with `#menu-close`, Escape, or a click whose
target is the dialog itself (backdrop); closing returns focus to
`#menu-button`. It contains:

* a header with a small `SYSTEM` label and `#menu-close`;
* **Game data**: `#menu-stored` (same `Stored: N archives` text),
  `#menu-storage` (the storage estimate), and `#reload` labelled
  `Reload game data` with a one-line warning that it deletes the local data;
* **Performance**: `#fps-toggle`, a checkbox with `role="switch"`, labelled
  `Performance overlay (FPS)`, and a one-line explanation;
* **About**: `OpenZH browser port`, one sentence that the game files stay on
  this device, and one line saying Escape closes the menu.

`#reload` is disabled while no archives are stored. It never deletes
anything by itself: it opens `#reload-dialog`, another native `<dialog>`,
with `#reload-warning`, `#reload-cancel` and `#reload-confirm`. The warning
names the current archive count and says the data will be permanently deleted
and the ZIPs selected again. Cancel closes the dialog and keeps all data.
Confirm disables both buttons, calls `clearStored()`, and then reloads the
page; the reloaded page shows the loader with `Stored: 0 archives`.

### Mute

The user's mute choice is stored in `localStorage` under `openzh.muted`
(`"1"`/`"0"`, default `"0"`). The engine receives
`userMuted || document.visibilityState !== "visible" || !document.hasFocus()`
as 1, otherwise 0, through `_GeneralsXSetAudioMuted` (the same export as
#99). It is applied when the engine resolves, on every blur/focus/
visibilitychange, and immediately when `#mute` is toggled. The call is skipped
when the export is absent, without an error or unhandled rejection.
`#mute`'s `aria-pressed` reflects the user's choice only, not the automatic
focus mute.

### Fullscreen

`#fullscreen` keeps #91's behaviour: request fullscreen on `#screen`, fit the
canvas to the screen preserving the drawing buffer's aspect ratio, focus the
canvas; on exit restore the windowed fit. `#screen` is the fullscreen element,
so the top bar is not part of the fullscreen view. The button is disabled
before the game starts and hidden when the API is unavailable. The drawing
buffer (`canvas.width`/`height` and their attributes) is never written by the
page.

### Performance overlay and the engine export

The page stores the toggle in `localStorage` under
`openzh.performanceOverlay` (`"1"`/`"0"`, default `"0"`, i.e. hidden). After
the engine resolves and on every toggle it calls
`_GeneralsXSetDebugOverlay(1|0)` if that export exists; a missing export is
ignored without an error. The setting is re-applied on every start, so a
page reload with the toggle on starts with the overlay visible.

`GeneralsMD/Code/GameEngineDevice/Source/SDL3GameEngine.cpp` adds:

```cpp
extern "C" EMSCRIPTEN_KEEPALIVE Int GeneralsXSetDebugOverlay(Int visible)
```

When `TheWritableGlobalData` is null it returns `FALSE`. When hiding it sets
`m_renderFpsFontSize`, `m_networkLatencyFontSize`, `m_systemTimeFontSize` and
`m_gameTimeFontSize` to 0. When showing it restores the values saved the first
time the overlay was hidden, or 8 when nothing was saved. If `TheInGameUI` is
non-null it calls `refreshRenderFpsResources()`,
`refreshNetworkLatencyResources()`, `refreshSystemTimeResources()` and
`refreshGameTimeResources()` so the change is visible immediately; it returns
`TRUE`. This is the only engine change in this task.

### Layout

`html, body` are `height: 100%`, `overflow: hidden`; `#app` is a grid with
`#topbar` and `#stage` rows. In every state the page itself does not scroll
vertically or horizontally. While playing, `#canvas` is the largest rectangle
with the drawing buffer's aspect ratio that fits in the viewport below the
top bar, centred horizontally. The windowed fit reads the bottom of `#topbar`
(replacing `#play-controls`); whole pixels, rounded down. `#screen` fills
`#stage`; in fullscreen it is fixed to the viewport and centres the canvas.
On a viewport shorter than the loader needs, `#stage` may scroll internally,
never the document.

At 1280x800 with a 1280x720 drawing buffer the canvas is 1280x720 at the
top-bar bottom; at 1920x1080 it is height-limited and horizontally centred.
No page text sits above the canvas.

### Visual system

* Tokens on `:root`: `--ink: #02060d`, `--navy: #061426`,
  `--panel: rgba(6, 20, 38, 0.84)`, `--line: rgba(76, 177, 255, 0.42)`,
  `--accent: #2ea8ff`, `--accent-soft: #8fd8ff`, `--text: #d8ecff`,
  `--muted: #7d9fbe`, `--danger: #ff4f66`, `--ok: #44e0a4`.
* Body background is never a flat `#000`/`#101214`: layer radial blue glows,
  a repeating 48 px blueprint grid, a vignette and a slow moving scanline.
  The decorative layers are `pointer-events: none` and behind `#app`.
* Panels use a cut-corner `clip-path` (polygon), a 1 px blue edge, an inner
  translucent navy fill and a faint glow. Buttons are uppercase 12 px with
  `letter-spacing` at least 0.12em, cut corners, a hover sheen and a blue glow;
  the primary action is a filled blue gradient with dark text; destructive
  actions use `--danger`. Icon buttons are 40-44 px square with a visible
  `:focus-visible` ring.
* Classes the tests may rely on: `.panel`, `.loader-panel`, `.menu-panel`,
  `.btn`, `.btn-primary`, `.btn-danger`, `.icon-btn`, `.scanline`,
  `.grid-layer`. The background uses real `div.grid-layer` and
  `div.scanline` elements (or equally named decorative elements) with
  `aria-hidden="true"` and `pointer-events: none`, so their computed style is
  observable.
* At least one CSS `@keyframes` animation runs on `.scanline` or
  `.grid-layer`; the loading state has a rotating ring. Under
  `@media (prefers-reduced-motion: reduce)` all animations and transitions
  are removed (`animation: none; transition: none`).
* Typography: condensed/system sans (`"Avenir Next Condensed"`, `"DIN
  Condensed"`, `"Arial Narrow"`, `system-ui`), monospace for numbers and
  status. `body` font-size is 14 px, labels 11-12 px, `#title` 18-20 px,
  loader heading at most 30 px. No text column above the game.
* No external CSS, JS, image or font request. The favicon stays
  `favicon.png`; the shell stylesheet is `shell.css` under `/app/`.

### DOM contract

`#app`, `#topbar`, `#title`, `#fullscreen`, `#mute`, `#menu-button`, `#stage`,
`#loader`, `#zip-input`, `#drop-zone`, `#import-progress`, `#import-detail`,
`#import-current`, `#import-cancel`, `#import-error`, `#unsupported`,
`#status`, `#storage`, `#storage-warning`, `#stored-summary`, `#loading`,
`#error-panel`, `#engine-error`, `#retry`, `#screen`, `#canvas`, `#menu`,
`#menu-close`, `#menu-stored`, `#menu-storage`, `#reload`, `#reload-dialog`,
`#reload-warning`, `#reload-cancel`, `#reload-confirm`, `#fps-toggle`.

There is no `#play`, `#clear` or `#play-controls` element. `#engine-error`
still precedes `#canvas` in document order. Hidden elements really use the
`hidden` attribute and compute to `display: none`.

### Preserved behaviour

ZIP import, its progress/cancel/errors, storage estimate and warning,
missing-feature detection, the `module` query parameter, the smoke page,
`__zhwpLog`/`__zhwpDone`, the no-EA-trademark rule, the favicon, the canvas
context-menu suppression, keyboard focus on the canvas, and the fullscreen
fit keep working. Issue #157's import-replacement semantics are not this
task's concern, but the launcher must keep whatever `importZips` reports,
including the `Removing the previous install` status, and must not assume
imports accumulate.

## Acceptance criteria

1. On load the only visible top-bar content is `#title` and the three icon buttons, `#topbar` is at most 64 px tall, each button contains an inline SVG and has a non-empty `aria-label` and `title`.
2. With no stored archives, `body[data-state="no-assets"]`, `#loader` is visible, `#canvas`/`#loading`/`#error-panel` are hidden, and no element with id `play` exists.
3. With the four required synthetic archives stored, loading the page starts the fake engine without any click, ends in `data-state="playing"`, and shows `#canvas`.
4. Importing a complete synthetic ZIP starts the fake engine automatically and reaches `#status` containing `Ready`, with no Play click.
5. A page load that auto-starts the engine invokes the module factory exactly once.
6. A fake module that rejects ends in `data-state="error"`, shows `#error-panel` with `#engine-error` containing the message, hides `#loading`, and keeps `#menu-button` usable.
7. Clicking `#retry` starts a second engine attempt (the fake records two factory calls) and the page leaves `data-state="error"`.
8. Clicking `#menu-button` opens `#menu` (`open` attribute, `aria-expanded="true"`), moves focus inside it, and closing with `#menu-close`, Escape or a backdrop click closes it and returns focus to `#menu-button`.
9. `#menu` shows the stored archive count and storage text, and `#reload` is disabled when `#stored-summary` is `Stored: 0 archives`.
10. Clicking `#reload` opens `#reload-dialog`; `#reload-warning` names the archive count and says the data will be deleted; Cancel closes it and leaves the stored archives untouched.
11. Confirming `#reload-confirm` clears the stored archives and reloads to the loader with `Stored: 0 archives`; it never clears before the confirmation.
12. `#fps-toggle` is unchecked by default, the fake engine receives `_GeneralsXSetDebugOverlay(0)` after it starts, and a missing export produces no error or unhandled rejection.
13. Checking `#fps-toggle` calls the fake export with 1 and writes `openzh.performanceOverlay="1"`; after a reload the auto-started engine receives 1; unchecking calls 0 and writes `"0"`.
14. `#mute` starts at `aria-pressed="false"`, a click calls `_GeneralsXSetAudioMuted(1)` and writes `openzh.muted="1"`, a second click calls 0 and writes `"0"`; after a reload the button is pressed and the first call is 1.
15. With the user unmuted, a window blur mutes with 1 and a following focus unmutes with 0; with the user muted, both stay 1.
16. `#fullscreen` is disabled before the game starts, enabled while playing, hidden when `requestFullscreen` is missing, and clicking it puts `#screen` in fullscreen and leaves `#canvas` focused.
17. While playing at 1280x800 with a 1280x720 buffer, the document does not scroll, the canvas keeps the buffer aspect ratio, lies fully inside the viewport, starts at the bottom of `#topbar` (within 1 px) and is horizontally centred.
18. While playing at 1920x1080 with a 1280x720 buffer, the canvas is height-limited (its height is the viewport height minus the top bar, within 1 px), keeps the aspect ratio and is horizontally centred, without page scroll.
19. The computed `body` font-size is at most 14 px, `#title` is 18-20 px, and no `#loader` heading is larger than 30 px.
20. `.grid-layer` has a non-`none` background image (a gradient or an inline image), `body`'s computed background colour is not pure black, and the `--accent` token resolves to a blue (blue channel greater than red and green).
21. At least one of `.scanline`/`.grid-layer` has a non-`none` animation name, `.panel` has a non-`none` `clip-path`, and `prefers-reduced-motion: reduce` makes animations and transitions `none`.
22. `#status` is a `role="status"` live region and `#import-error`/`#unsupported`/`#engine-error` are `role="alert"`.
23. The page title and every `h1`/`h2` match neither `/Command\s*&\s*Conquer/i` nor `/Generals|Zero Hour/i`.
24. With `navigator.storage.getDirectory` removed, `#unsupported` is visible, `#zip-input` is disabled and no engine starts even with archives present.
25. The existing storage estimate, storage warning, importer progress/cancel and typed import-error behaviour still pass in the migrated specs.
26. Loading the page makes no request to an external origin: every request stays on the dev server origin (the shell CSS is local, icons are inline SVG, and no font or image is fetched from the network).
27. No element with id `play`, `clear` or `play-controls` exists in the document.

## Test paths

### T1 — new coverage (write only these)

* `web/tests/launcher-shell.spec.ts`: criteria 1-7, 23, 27.
* `web/tests/launcher-menu.spec.ts`: criteria 8-11, 14-15.
* `web/tests/launcher-debug-overlay.spec.ts`: criteria 12-13.
* `web/tests/launcher-style.spec.ts`: criteria 16, 19-22, 26.
* `web/tests/harness/overlay/records.js`: a fake engine that records
  `_GeneralsXSetDebugOverlay` calls in `window.__overlayCalls`, sets
  `window.__fakeEngineLoaded = "overlay"`, and can omit the export.

### T2 — migrate the existing specs (write only these)

`web/tests/launcher.spec.ts`, `launcher-canvas.spec.ts`,
`launcher-window-layout.spec.ts`, `launcher-fullscreen.spec.ts`,
`launcher-fullscreen-fallbacks.spec.ts`, `launcher-errors.spec.ts`,
`launcher-features.spec.ts`, `launcher-input.spec.ts`,
`launcher-mute.spec.ts`, `launcher-storage.spec.ts`,
`launcher-zip.spec.ts`, `launcher-visibility.spec.ts`,
`launcher-favicon.spec.ts`, and `web/tests/helpers/` if a shared
auto-start/reset helper is needed. Cover criteria 17-18 and 24-25 there and
keep every existing behaviour. Do not edit T1's new files.

T1 and T2 must run on the old code first and fail for the reason each
criterion names, not because of a typo or a missing helper. Tests wait on
observable state, never fixed delays. Fake engines are selected with the
`module` query parameter. All game data in tests is synthetic.

Issue #157 may land while this task runs. If its import-replacement tests are
already in T2's worktree, keep their `Removing the previous install` and
replace-the-previous-install expectations and only migrate their DOM/auto-start
assumptions; do not revert #157's import semantics.

## Allowed paths

### I1 — web UI

* `web/app/index.html`
* `web/app/shell.css` (new)
* `web/src/main.ts`
* `web/src/shell.ts` (new, optional)
* `web/src/prefs.ts` (new, optional)

### I2 — engine export

* `GeneralsMD/Code/GameEngineDevice/Source/SDL3GameEngine.cpp`

Neither implementer edits tests, the brief, `package.json`, `scripts/` or the
other implementer's paths.

## Check

After both implementation streams are merged, from a clean checkout:

1. `scripts/build-webgpu.sh` exits 0 and the built
   `build/webgpu/GeneralsMD/GeneralsXZH.js` contains
   `_GeneralsXSetDebugOverlay`.
2. `cd web && npm ci && ZHWP_PORT=4193 npx playwright test` exits 0 in Brave.

T1's local check: `cd web && ZHWP_PORT=4191 npx playwright test
tests/launcher-shell.spec.ts tests/launcher-menu.spec.ts
tests/launcher-debug-overlay.spec.ts tests/launcher-style.spec.ts` (expected
to fail before implementation).

T2's local check: `cd web && ZHWP_PORT=4192 npx playwright test
tests/launcher.spec.ts tests/launcher-canvas.spec.ts
tests/launcher-window-layout.spec.ts tests/launcher-fullscreen.spec.ts
tests/launcher-fullscreen-fallbacks.spec.ts tests/launcher-errors.spec.ts
tests/launcher-features.spec.ts tests/launcher-input.spec.ts
tests/launcher-mute.spec.ts tests/launcher-storage.spec.ts
tests/launcher-zip.spec.ts tests/launcher-visibility.spec.ts
tests/launcher-favicon.spec.ts` (expected to fail before implementation).

## Out of scope

* New in-game menus, unit art or any EA asset.
* Networking, replays and the oracle.
* Import-replacement internals (#157).
* An audio volume slider (the engine has no export for it).
* Downloading logs or telemetry.
