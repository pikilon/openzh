# 191: The About dialog explains what OpenZH is

Issue #191. Phase 1. Size s. Owner's request (2026-10-19): "mejora el about
explicando este proyecto mejor".

The current dialog is a three-row fact sheet plus a one-line disclaimer. A new
player cannot tell what the project is, where the engine comes from, what
happens to the game files, or how finished it is. The existing contract keeps
`#about-name`, `#about-version`, `#about-license`, `#about-source`,
`#about-disclaimer` and `#about-close`, and the dialog must keep naming no EA
trademark (the launcher already avoids all three marks).

## Contract

* `#about-dialog` gains an introduction, three short sections and a second
  source link:
  * what OpenZH is: a browser port of the 2003 real-time strategy engine,
    compiled from its GPL-3.0 source release to WebAssembly, rendered through
    WebGPU;
  * what happens to the player's files: selected as ZIPs, kept in this
    browser's private storage, never uploaded or shipped with the project;
  * the state of the port: skirmish against the computer and the campaign are
    the goals, rough edges are expected, the issue tracker is the place for
    them;
  * independence: unofficial, not affiliated with or endorsed by Electronic
    Arts, game data belongs to its owners.
* The fact grid keeps Name, Version and License with the existing ids and
  values. A new link `#about-issues` points to
  `https://github.com/pikilon/openzh/issues` with `target="_blank"` and
  `rel="noopener noreferrer"`.
* The disclaimer keeps the words "unofficial", "supplies/supplied" and
  "files" (the #159 assertion).
* The dialog scrolls inside `max-height` on a 375x812 viewport and the Close
  button stays reachable; the layout does not scroll horizontally.
* No `Command & Conquer`, `Generals` or `Zero Hour` in the dialog text.

## Acceptance criteria

1. The About dialog explains the port, the GPL source release and WebGPU in at
   least two paragraphs outside the fact grid.
2. It says the player's files stay in the browser and are never uploaded.
3. It states the project is unofficial and not affiliated with or endorsed by
   Electronic Arts, and that players supply their own game data.
4. It describes the port's current scope and that rough edges are expected.
5. `#about-name`, `#about-version`, `#about-license`, `#about-source` and
   `#about-disclaimer` keep their #159 values; `#about-issues` opens the issue
   tracker in a new tab with `noopener noreferrer`.
6. On 375x812 the dialog stays inside the viewport, has no horizontal
   overflow and `#about-close` is clickable; closing returns focus to #about.
7. The dialog text names no EA trademark.

## Test paths

* `web/tests/launcher-about.spec.ts`: criteria 1-7.

## Allowed paths

* `web/app/index.html`
* `web/app/shell.css`
* `web/tests/launcher-about.spec.ts`

## Check command

`cd web && npx playwright test tests/launcher-about.spec.ts tests/launcher-menu.spec.ts`

The new criteria fail on the old dialog: `#about-issues` and the explanatory
sections do not exist.
