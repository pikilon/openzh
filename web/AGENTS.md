# web/

The browser side of the port: the launcher page, the TypeScript wrapper
(importing the player's game files, OPFS/IndexedDB storage, networking) and
the browser tests. Root `AGENTS.md` rules apply; these add to them.

* Nothing here comes from wasm-generals' `web/` (D-01): write it here.
* Every response the dev server sends carries COOP `same-origin`, COEP
  `require-corp` and CORP `same-origin`: threads and `SharedArrayBuffer`
  need cross-origin isolation.
* Tests: Playwright (`npm test`) in Brave only (D-04); `BRAVE_PATH` overrides
  the binary. Manual checks use Brave or the agent's built-in browser, never
  Chrome or Firefox. The engine must be built first with
  `scripts/build-webgpu.sh` at the repository root.
* Keep dependencies few and pinned to exact versions.

## Local Game Data

The owner's machine has a legitimate copy of the game outside the repository.
The launcher loads it from ZIP files only. No game data lives in this directory,
its fixtures or test output: tests use synthetic data, and real data only
through `ZHWP_GAME_ZIPS` (the ZIPs built by `web/scripts/make-game-zip.mjs
--split`), locally. `ZHWP_GAME_DIR` (the exact path is in the gitignored
`CLAUDE.local.md`) is only the input of that script, not an import path. Never
copy the ZIPs or any game file into the repository, its build output, CI or
artifacts.
