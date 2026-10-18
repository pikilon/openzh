# 132: Move the real-data tests and dev flow from the game folder to ZIPs

Issue #132. Phase 1. Size m. Depends on #128, #129, #130 and #131. **Run by
the lead, not delegated**: these specs only run against the owner's real
game files, so they skip everywhere else and cannot "fail first"; the lead
verifies them against the real ZIPs (owner request 2026-10-18).

## Goal
Every spec that reads the real game does it through ZIPs, so the folder path
can be removed in #133.

## Contract
* New env var `ZHWP_GAME_ZIPS`: absolute paths of the game ZIPs separated by
  `:` (the output of #131 with `--split`, kept on the external SSD next to
  the game, never in the repository). `ZHWP_GAME_DIR` stays only as the
  input of `make-game-zip.mjs`.
* `real-data*.spec.ts` (`real-data`, `-audio`, `-fonts`, `-replay`,
  `-textures`, `-webgpu`) skip unless every path in `ZHWP_GAME_ZIPS` exists,
  and load the game with `page.locator("#zip-input").setInputFiles(paths)`.
  Playwright passes the files by path, so the multi-GB ZIPs are not loaded
  into the test's memory.
* A shared helper `web/tests/helpers/real-game.ts` exports
  `gameZips(): string[] | null` so the six specs stop repeating the check.
* `web/AGENTS.md` and the specs' header comments name `ZHWP_GAME_ZIPS`.
* The folder path still works at the end of this task; #133 removes it.

## Acceptance criteria
1. With `ZHWP_GAME_ZIPS` unset, the six specs skip and `npx playwright test` is green.
2. With the two real ZIPs, `real-data.spec.ts` reaches `GENERALSX_LOAD_DONE` (the main menu), in the built-in browser and in Brave.
3. The other five real-data specs pass with the same ZIPs.
4. No file of the game exists inside the repository or its test output (`scripts/check-no-ea-assets.sh` passes).

## Allowed paths
`web/tests/real-data*.spec.ts`, `web/tests/helpers/real-game.ts`, `web/AGENTS.md`

## Check
`cd web && env -u ZHWP_GAME_ZIPS npx playwright test && ../scripts/check-no-ea-assets.sh`, then the real-data specs with `ZHWP_GAME_ZIPS` set.
