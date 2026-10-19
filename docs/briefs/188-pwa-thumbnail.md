# 188: An installable launcher with icons and a link preview

Issue #188. Phase 1. Size m. Owner's request (2026-10-19): "crear una webapp
instalable con sus iconos y con preview de la web con thumbnail".

The launcher already runs over HTTPS behind the cross-origin-isolation service
worker, so the browser can install it, but there is no manifest, no app icon
set and no image for a shared link. The published site moves `web/app/*` to the
site root (`scripts/publish-pages.mjs`), the development server keeps it under
`/app/`: every new URL must be relative to the manifest or the page so both
layouts work.

## Artwork

The icons and the card are OpenZH's own geometric mark (a hexagon, the "OZ"
monogram and the command-console palette). No EA asset, trademark, logo or
screenshot of the game is used; the only screenshot is of the launcher page
itself, with no game data loaded.

Committed files under `web/app/`:

* `manifest.webmanifest`
* `icons/icon-192.png`, `icons/icon-512.png`, `icons/icon-maskable-512.png`
* `icons/apple-touch-icon.png` (180x180)
* `screenshots/launcher-wide.png` (1280x720, the launcher in `no-assets`)
* `og.png` (1200x630, the Open Graph / Twitter card)

## Contract

* The page links `manifest.webmanifest` relatively, plus
  `apple-touch-icon`, `theme-color`, `application-name`, the Apple web-app
  tags and the Open Graph/Twitter tags. `og:image` and `twitter:image` are
  `https://openzh.pikilon.com/og.png`; the card is 1200x630. The metadata
  names no EA trademark.
* The manifest has `name` and `short_name` "OpenZH", a description,
  `start_url: "./"`, `scope: "./"`, `display: "standalone"`, a background and
  theme colour, 192 and 512 `any` icons, a 512 `maskable` icon and a
  1280x720 `wide` screenshot. Every `src` is relative and inside `app/`.
* `start_url: "./"` resolves to `/app/` on the development server and to `/`
  on the published site; the icon and screenshot URLs follow their manifest.
* `scripts/serve.mjs` serves `.webmanifest` as
  `application/manifest+json; charset=utf-8`. `scripts/package.mjs` copies the
  whole `app/` folder, so package output includes the manifest and the images.
* Existing contracts keep holding: the favicon (#103), the package tree and
  the launcher specs.

## Acceptance criteria

1. The page has one `link[rel="manifest"]` resolving to
   `/app/manifest.webmanifest`; the file is served with the manifest media
   type and parses.
2. The manifest names OpenZH, declares `standalone`, relative `start_url` and
   `scope` and valid background/theme colours. `start_url` resolves to `/app/`
   in development and `/` when the manifest is at the site root.
3. The manifest declares a 192x192 and a 512x512 icon usable as `any` and a
   512x512 `maskable` icon; each is a real PNG of exactly that size.
4. It declares a 1280x720 wide `form_factor` screenshot which is a real PNG of
   that size; every manifest asset URL is relative and stays inside `/app/`.
5. The page links a 180x180 Apple touch icon, declares a theme colour and
   carries Open Graph and Twitter card metadata; `/app/og.png` is a 1200x630
   PNG and `og:image`/`twitter:image` point at the published URL.
6. The manifest and the page's app metadata contain no `Command & Conquer`,
   `Generals` or `Zero Hour`.
7. The package output contains the manifest, the icons, the screenshot and
   `og.png` next to `app/index.html`.

## Test paths

* `web/tests/launcher-pwa.spec.ts`: criteria 1-6.
* `web/tests/package.spec.ts`: criterion 7.

## Allowed paths

* `web/app/manifest.webmanifest`
* `web/app/icons/`
* `web/app/screenshots/`
* `web/app/og.png`
* `web/app/index.html`
* `web/scripts/serve.mjs`
* `web/tests/launcher-pwa.spec.ts`
* `web/tests/package.spec.ts`

## Check command

`cd web && npx playwright test tests/launcher-pwa.spec.ts tests/package.spec.ts tests/launcher-favicon.spec.ts`

Before the manifest existed, criterion 1 failed at the missing link and
criterion 2 at the 404; the package test failed on the missing
`app/manifest.webmanifest`.
