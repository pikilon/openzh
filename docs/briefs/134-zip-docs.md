# 134: Docs: decision for ZIP loading and updated web guides

Issue #134. Phase 1. Size s. Depends on #133.

## Goal
The written project knowledge matches the ZIP-only loading.

## Read first
`docs/decisions.md` (D-03, D-05 for the style), `web/AGENTS.md`,
`AGENTS.md`, `README.md`, `docs/briefs/README.md`

## Contract
* `docs/decisions.md`: new entry `## D-10: The game is loaded from ZIP files`
  with Date 2026-10-18, Status accepted, Context (folder pick replaced; whole
  game, nothing filtered; persistence in OPFS; no upload, no cloud, no remote
  source), Decision, Consequences (two ZIPs because of the ~2 GB reported
  quota, #70; `ZHWP_GAME_DIR` only feeds `make-game-zip.mjs`; `ZHWP_GAME_ZIPS`
  for real-data tests; the ZIPs never live in the repository), in the format
  of the neighbouring entries.
* `web/AGENTS.md`: the "Local Game Data" section describes `ZHWP_GAME_ZIPS`
  and `make-game-zip.mjs` and no longer mentions the folder pick or
  `--gamedata`.
* `README.md`: one short paragraph telling the player how to load the game
  (pick or drop the ZIP files; they stay in the browser, nothing is
  uploaded; the page remembers them).
* `docs/briefs/README.md` and `AGENTS.md` mention nothing that is now false.

## Acceptance criteria
1. `docs/decisions.md` contains the heading `## D-10: The game is loaded from ZIP files` and the words `ZHWP_GAME_ZIPS` and `nothing is uploaded` (any case).
2. `web/AGENTS.md` contains `ZHWP_GAME_ZIPS` and `make-game-zip.mjs` and does not contain `--gamedata`, `folder-input` or `webkitdirectory`.
3. `README.md` mentions loading the game from ZIP files and that nothing is uploaded.
4. `scripts/check-no-ea-assets.sh` still passes.

## Test paths
`web/tests/docs-zip.spec.ts`

## Allowed paths
`docs/decisions.md`, `web/AGENTS.md`, `README.md`, `docs/briefs/README.md`, `AGENTS.md`

## Check
`cd web && npx playwright test tests/docs-zip.spec.ts && ../scripts/check-no-ea-assets.sh`
