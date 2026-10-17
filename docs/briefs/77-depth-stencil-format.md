# 77: Render passes must get a depth-stencil format, not a colour texture

Issue #77. Phase 1. Size m. Found by #33 with the owner's real data
(2026-10-17): the engine loads and runs, but on most frames WebGPU rejects
the render pass with `The depth stencil attachment [TextureView of Texture
(unlabeled 512x512 px, TextureFormat::RGBA8Unorm)] format
(TextureFormat::RGBA8Unorm) is not a depth stencil format`, the command
buffer is invalid and the frame is dropped. The owner sees a black canvas
with occasional flickering images.

## Goal
Every render pass the WebGPU D3D8 translation begins has, as its
depth-stencil attachment, either nothing or a texture view in a WebGPU
depth or depth-stencil format, so no frame is dropped for this reason.

## Read first
* `Core/GameEngineDevice/Source/WebGPUDevice/WebGPUD3D8.cpp`: the render
  pass setup (around `passDescriptor.depthStencilAttachment`, line ~867),
  `CreateDepthStencilSurface` (~2571), `SetRenderTarget` (~2628), and the
  format checks near the end (~3731)
* D3D8 semantics: `SetRenderTarget(renderTarget, depthStencil)` with a
  `nullptr` depth surface means "no depth buffer"; the engine renders into
  512×512 textures (render-to-texture) with and without depth
* `docs/upstream/GeneralsX-AGENTS.md` (annotations)

## Contract
* A depth-stencil attachment is only ever a view of a texture created in a
  WebGPU depth or depth-stencil format matching the D3D depth format
  (`D3DFMT_D16` → `Depth16Unorm`, `D3DFMT_D24S8`/`D24X8` →
  `Depth24PlusStencil8` or `Depth24Plus`, `D3DFMT_D32` → `Depth32Float`, or
  the closest WebGPU equivalent already used by this file).
* When the current D3D depth-stencil surface is absent, or is not a depth
  surface, the pass has no depth-stencil attachment (or a depth texture of
  the render target's size that this layer creates for it), never the colour
  texture.
* A depth attachment and the colour attachment of a pass have the same
  size.
* Behaviour of passes that already work (main back buffer with its depth
  buffer) does not change.
* Every changed line carries `// GeneralsX @bugfix zhwp 17/10/2026 <why>`.

## Acceptance criteria
1. With the owner's game data, from Play until 20 s after `GENERALSX_LOAD_DONE`, `__zhwpLog` contains no line with `is not a depth stencil format`.
2. In the same run, the number of `[Invalid CommandBuffer]` lines is zero.
3. 20 s after `GENERALSX_LOAD_DONE`, a screenshot of `#canvas` has at least 16 distinct colours (the shell map behind the main menu is drawn).
4. The synthetic test suite (`npx playwright test` without `ZHWP_GAME_DIR`) still passes.

## Test paths
* `web/tests/real-data-webgpu.spec.ts`: local only, skipped unless
  `ZHWP_GAME_DIR` is set; imports the data through the launcher like
  `web/tests/real-data.spec.ts`; screenshots go to the system temp folder.

## Allowed paths
* `Core/GameEngineDevice/Source/WebGPUDevice/WebGPUD3D8.cpp`

## Build
Agents cannot build the engine. The implementer edits, then answers DONE;
the architect runs `scripts/build-webgpu.sh` and returns compiler errors (at
most three rounds within the same attempt). A run of the check that fails
after a successful build ends the attempt.

## Check command
`scripts/build-webgpu.sh && cd web && npm ci && npx playwright test tests/real-data-webgpu.spec.ts && env -u ZHWP_GAME_DIR npx playwright test`
(run by the architect, locally, with `ZHWP_GAME_DIR` set; never in CI)
