# 78: Upload the small mip levels of compressed textures

Issue #78. Phase 1. Size s. Depends on #77 (same file). Found by #33: some
`WriteTexture` calls for DXT (BC1–BC3) textures fail with `copySize.width
(1|2) is not a multiple of compressed texture format block width (4)` (and
the same for height), so those mip levels stay empty.

## Goal
Mip levels smaller than 4×4 of block-compressed textures upload without
WebGPU validation errors, as a full 4×4 block, which is how D3D stores them.

## Read first
* `Core/GameEngineDevice/Source/WebGPUDevice/WebGPUD3D8.cpp`: the DXT
  helpers near the top (lines ~50–200) and the texture upload around
  `wgpuQueueWriteTexture` (~3446)
* WebGPU rule: for block-compressed formats the copy extent of a mip level
  must be rounded up to whole blocks (the "physical size" of the level)

## Contract
* For BC formats, each mip level's copy extent is the level's size rounded
  up to a multiple of 4 in width and height; the source layout uses the same
  block counts. Levels of 4×4 and larger are unchanged.
* The texture itself is still created with the D3D dimensions.
* Every changed line carries `// GeneralsX @bugfix zhwp 17/10/2026 <why>`.

## Acceptance criteria
1. With the owner's game data, from Play until 20 s after `GENERALSX_LOAD_DONE`, `__zhwpLog` contains no line with `is not a multiple of compressed texture format block`.
2. The synthetic test suite still passes.

## Test paths
* `web/tests/real-data-textures.spec.ts`: local only, skipped unless
  `ZHWP_GAME_DIR` is set; same import as `web/tests/real-data.spec.ts`.

## Allowed paths
* `Core/GameEngineDevice/Source/WebGPUDevice/WebGPUD3D8.cpp`

## Build
As in `docs/briefs/77-depth-stencil-format.md`: the architect builds, at
most three rounds of compiler errors within the attempt.

## Check command
`scripts/build-webgpu.sh && cd web && npm ci && npx playwright test tests/real-data-textures.spec.ts && env -u ZHWP_GAME_DIR npx playwright test`
(run by the architect, locally)
