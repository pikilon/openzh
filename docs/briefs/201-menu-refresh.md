# 201: Refresh button in the hamburger menu

Issue #201. Phase 1. Size s. Owner's request (2026-10-21): add a refresh
button; after the first plan put it in the top bar, the owner asked for it
inside the hamburger menu instead.

Today the menu (`#menu`) offers "Reload game data" (`#reload`), which opens
`#reload-dialog` and deletes the stored archives. Nothing on the page just
loads the current document again: `window.location.reload()` appears only in
the destructive maintenance paths (import a backup, delete and reload). A
player who installed the web app, or who is in fullscreen, has no browser
reload control inside the page.

## Goal

A "Refresh page" button inside the hamburger menu reloads the current document
and keeps everything stored: game data, saves and preferences.

## Read first

* `web/app/index.html`: `#menu`, its `.menu-head` and `.menu-body`, and the
  Game data section with `#reload`.
* `web/src/main.ts`: the menu constants, `openMenu`, `wireMenu`,
  `deleteStoredAndReload` and `refreshOffline`.
* `web/tests/launcher-menu.spec.ts`: `openShell`, `openMenu`, `startPlaying`
  and the `#reload-confirm` test that waits for a `load` event.

## Contract

* Markup: a new first section in `.menu-body` headed `App`, holding
  `<button id="refresh-page" class="btn" type="button">Refresh page</button>`
  and a `.hint` that says the page reloads and the stored data stays. The
  button is enabled in every page state and never appears in `#topbar`.
* Behaviour: a click calls `window.location.reload()` and nothing else. It
  must not clear or release storage, close the menu first, or touch the saved
  preferences.
* `#reload`, `#reload-dialog` and the top bar keep their current behaviour.
* The text is English and names no EA trademark.

## Acceptance criteria

1. With `#menu` open, `#refresh-page` is inside `#menu`, visible and enabled, its `type` is `"button"`, and it is not inside `#topbar`.
2. Its visible text and its accessible name are both "Refresh page".
3. Clicking it loads a new document (a marker set on `window` before the click is gone) and the shell comes back in the `no-assets` state.
4. After a synthetic install has reached `playing`, clicking `#refresh-page` loads a new document that returns to `playing`, shows `Stored: 4 archives` and a visible `#canvas`, so nothing was cleared.

Criteria 1 and 2 fail on today's page because the element does not exist;
criteria 3 and 4 then decide the reload and the untouched storage.

## Test paths

* `web/tests/launcher-menu.spec.ts`: criteria 1-4.

## Allowed paths

* `web/app/index.html`
* `web/src/main.ts`
* `web/tests/launcher-menu.spec.ts`
* `docs/tasks.json`

## Check command

```sh
cd web && npx playwright test tests/launcher-menu.spec.ts
```
