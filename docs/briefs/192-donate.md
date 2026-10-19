# 192: A donation button in the top bar and a donation modal

Issue #192. Phase 1. Size s. Owner's request (2026-10-19): "añade el botón de
donación con el mismo estilo a la barra superior fuera del menú de hamburguesa,
la donación debe ser una modal también donde diga que puede mandar sugerencias
en el mensaje como en red-line".

The three tip links currently live only inside `#menu`.
The top bar gets a fourth icon button, `#donate`, with the same `.icon-btn`
style as fullscreen, mute and the hamburger. It opens a native `<dialog>`
instead of leaving the page. The old `#support` tip row stays in the menu
(existing contract), and the same three PayPal destinations appear in the
modal.

## Contract

* `<button id="donate" class="icon-btn" type="button">` sits in
  `#topbar .topbar-actions`, before `#fullscreen`; inline SVG heart, non-empty
  `aria-label` and `title` "Support OpenZH". No visible text.
* `#donate-dialog` is a `.panel.dialog-panel` opened with `showModal()`. It
  contains:
  * a heading "Support OpenZH";
  * a paragraph saying OpenZH is free, the tip is optional and unlocks
    nothing;
  * a paragraph saying suggestions and bug reports can be sent in the PayPal
    message when tipping (the Red Line convention), plus a link to the issue
    tracker `#donate-issues` (same URL as #191's, new tab, noopener
    noreferrer);
  * three links `#donate-tip-1`, `#donate-tip-2`, `#donate-tip-5` to
    `https://paypal.me/pikilongeorgia/1|2|5`, `target="_blank"`,
    `rel="noopener noreferrer"`; nothing is fetched on page load;
  * a `#donate-close` primary button.
* Clicking `#donate` opens the dialog. Escape, the close button or a backdrop
  click closes it and returns focus to `#donate`.
* The menu's `#support` row is unchanged.
* The dialog text names no EA trademark.

## Acceptance criteria

1. `#donate` is inside `#topbar`, not inside `#menu`, is visible before any
   game data is stored, has the `icon-btn` class, an inline SVG and the labels
   "Support OpenZH".
2. The top bar's visible controls are exactly `donate`, `fullscreen`, `mute`,
   `menu-button` in that order after `#title`; no visible text is added.
3. Clicking `#donate` opens `#donate-dialog` as a modal; it says the project
   is free, the tip is optional and unlocks nothing, and that suggestions or
   bug reports can be included in the PayPal message.
4. The three tip links have the exact destinations, target and rel.
5. `#donate-issues` points to the issue tracker in a new tab with
   `noopener noreferrer`.
6. `#donate-close` closes the dialog and returns focus to `#donate`; Escape
   does the same.
7. The dialog text names no EA trademark.

## Test paths

* `web/tests/launcher-donate.spec.ts`: criteria 1-7.
* `web/tests/launcher-shell.spec.ts`: update test 1 for the fourth top-bar
  button and the new order (criterion 2).

## Allowed paths

* `web/app/index.html`
* `web/app/shell.css`
* `web/src/main.ts`
* `web/tests/launcher-donate.spec.ts`
* `web/tests/launcher-shell.spec.ts`

## Check command

`cd web && npx playwright test tests/launcher-donate.spec.ts tests/launcher-shell.spec.ts tests/launcher-menu.spec.ts`

The new tests fail on HEAD: `#donate` and `#donate-dialog` do not exist, and
the updated top-bar contract expects four buttons.
