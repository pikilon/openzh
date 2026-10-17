# 103: A Zero Hour favicon so the tab is recognisable

Issue #103. Phase 1. Size s. Owner's request (2026-10-17): the launcher page
has no favicon, so the tab shows the browser's generic icon. Owner's rule: the
icon comes from the asset catalog, and the implementer picks which file; no
drawn, traced or AI-generated art.

## The asset, vetted
The catalog (`cnc-assets`) lists the application icons EA shipped in the GPL
source release. Two are candidates:

* `01_EA_GPL_Source_Releases/electronicarts/CnC_Generals_Zero_Hour/GeneralsMD/Code/Tools/Launcher/Generals.ico`
  (9,822 bytes; the launcher's own icon; 48x48 with transparency when
  converted). Recommended: it is the launcher icon, and its transparent
  background reads well at tab size.
* `01_EA_GPL_Source_Releases/electronicarts/CnC_Generals_Zero_Hour/GeneralsMD/Code/Main/Generals.ico`
  (21,630 bytes; the executable's icon; 48x48).

Catalog facts (`ficha` 5745 and 5528): origin `01_EA_GPL_Source_Releases`,
tag `gpl-3.0`, `redistributable: 1`; the origin's licence is "GPL-3.0 + EA's
additional terms". Both files are part of the GPL source release, not game
data extracted from the `.big` archives, so one may be committed under that
licence; a `.png` needs no `scripts/no-ea-assets.allow` entry.

Legal caveats, stated for the record: `AGENTS.md` forbids EA assets in the
repository, and the source release is the exception the project already uses
for the fonts and the allowlisted required assets; the repository is private
today, and `AGENTS.md` requires raising the trademark question with the owner
before the repository or the site goes public. The favicon is the game's own
icon, and this issue is the owner's explicit request for it. The file name and
every added string stay free of "Command & Conquer", "Generals" and "Zero
Hour": the file is `web/app/favicon.png`.

## Contract
* The launcher page's `<head>` links the icon with a relative href:
  `<link rel="icon" type="image/png" sizes="48x48" href="favicon.png">`. It
  resolves to `/app/favicon.png` both from the development server (mount
  `/app=app`) and from the packaged `app/` folder.
* `web/app/favicon.png` is a 48x48 PNG with transparency, converted from the
  chosen ICO with
  `sips -s format png "<abspath>" --out web/app/favicon.png`. The implementer
  picks one of the two candidates and says which in the PR description.
* `web/scripts/package.mjs` copies `app/favicon.png` into `<out>/app/favicon.png`
  next to `app/index.html`; the packaged page serves it from the same relative
  path, and the output still has only `app`, `dist`, `engine`, `index.html`
  and `_headers` at the top level.
* A missing icon never blocks the game: the page does not fetch the icon from
  JavaScript, and a 404 for it leaves the launcher and Play working.
* No user-visible string in the page mentions an EA trademark.
* Existing contracts keep holding: the launcher specs and the package
  contract (#32).

## Acceptance criteria
1. `GET /app/index.html` has a `<link rel="icon">` whose `href` resolves to `/app/favicon.png`.
2. `GET /app/favicon.png` returns 200 with an image content type and the PNG signature.
3. With `/app/favicon.png` routed to 404, the launcher still imports a synthetic install and Play starts the fake engine with no `#engine-error`.
4. `node scripts/package.mjs` with a synthetic engine writes `app/favicon.png` byte-identical to `web/app/favicon.png`, and the packaged `app/index.html` still links it.
5. The page's title, headings and the icon link carry no `Command & Conquer`, `Generals` or `Zero Hour` text.

## Test paths
* `web/tests/launcher-favicon.spec.ts`: criteria 1, 2, 3 and 5.
* `web/tests/package.spec.ts`: criterion 4, next to the existing package
  contract tests.

## Allowed paths
* `web/app/index.html`
* `web/app/favicon.png`
* `web/scripts/package.mjs`

## Check command
`cd web && npm ci && npx playwright test && npm run package`

`npm run package` also runs `scripts/check-no-ea-assets.sh` over the packaged
output, so a forbidden file type never ships.

## Out of scope
Any other artwork, an SVG or multi-size icon set, and the trademark decision
for a public release (owner's).
