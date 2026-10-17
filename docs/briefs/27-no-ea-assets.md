# 27: No-EA-assets guard script

Issue #27. Phase 1. Size s. `local-model-ok`. Brings forward the guard
script from #2 (whose CI part stays deferred) so it can be run locally and by
the static package (#32).

## Goal
No EA game data may enter the repository, a release or a package
(`AGENTS.md`, Legal Limits). A script fails when it finds game-data file
types outside an explicit allowlist.

## Read first
* `AGENTS.md` (Legal Limits), issue #2's scope
* `scripts/local-agent.sh` (style of an existing shell tool)

## Contract
`scripts/check-no-ea-assets.sh [<dir>...]`

* Bash, `set -uo pipefail`. Run from anywhere in the repository; works
  relative to the repository root (`git rev-parse --show-toplevel`).
* Without arguments it scans the files git tracks (`git ls-files`). With
  arguments it scans every regular file under each given directory instead
  (paths printed relative to the current directory as given).
* Forbidden extensions (case-insensitive): `.big .ani .scb .w3d .csf .str
  .wnd .tga .dds .rep .map .wav .mp3 .bik .data`.
* Allowlist: `scripts/no-ea-assets.allow`, one repository-relative path per
  line; empty lines and lines starting with `#` are ignored. A listed path is
  accepted only in the no-argument (tracked files) mode. It starts with
  exactly the files the repository tracks today that match the list (they
  come from EA's GPL source release):
  * `Core/Libraries/Source/WWVegas/WW3D2/RequiredAssets/AddProjectorGradient.tga`
  * `Core/Libraries/Source/WWVegas/WW3D2/RequiredAssets/MultProjectorGradient.tga`
  * `Core/Libraries/Source/WWVegas/WW3D2/RequiredAssets/ShatterPlanes0.w3d`
  * `Core/Libraries/Source/WWVegas/WW3D2/RequiredAssets/w3d_missing_texture.tga`
  * `Core/Tools/W3DView/Res/Light.w3d`
  * `Core/Tools/W3DView/Res/cursor.tga`
  * `Core/Tools/W3DView/Res/grab.tga`
  * `Core/Tools/W3DView/Res/orbit.tga`
  * `Core/Tools/W3DView/Res/zoom.tga`
  * `GeneralsZH/Data/Window/Menus/ExtrasMenu.wnd`
* Output: each offending path on its own line, then a last line
  `no-ea-assets: OK (<n> files checked)` or
  `no-ea-assets: FAIL (<k> forbidden files)`.
* Exit 0 when nothing is found, 1 when something is found, 2 when a given
  directory does not exist.

## Acceptance criteria
1. A directory with only allowed file types passes with exit 0 and the OK line.
2. A directory holding a file with any forbidden extension fails with exit 1 and prints that file's path.
3. Extensions are matched case-insensitively (`INI.BIG` fails).
4. Files of every depth under a given directory are scanned.
5. A path in the allowlist is accepted in tracked-files mode and is not accepted in directory mode.
6. Blank and `#` lines in the allowlist are ignored.
7. A directory argument that does not exist exits 2.
8. Without arguments, on this repository as it is, the script exits 0.

## Test paths
* `scripts/tests/`

## Allowed paths
* `scripts/check-no-ea-assets.sh`
* `scripts/no-ea-assets.allow`

## Check command
`bash scripts/tests/check-no-ea-assets.test.sh && scripts/check-no-ea-assets.sh`
