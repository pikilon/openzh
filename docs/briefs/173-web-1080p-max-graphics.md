# 173: Web defaults: 1920x1080 and maximum graphics

Issue #173. Phase 1. Size s. Owner request 2026-10-19: the browser port must
open at 1920x1080 with maximum graphics by default; the game is from 2003 and
any current browser machine can run it.

## Goal

On a fresh browser profile, the engine renders at 1920x1080 and starts at the
VeryHigh detail level with 4x MSAA, anisotropic 16x filtering, terrain LOD max
and dynamic LOD off. Saved `Options.ini` choices still win, and native builds
keep their current defaults.

## Read first

* `Core/GameEngine/Include/Common/GameDefines.h`: `DEFAULT_DISPLAY_WIDTH/HEIGHT`
  are the 1024x768 design reference; do not change them.
* `GeneralsMD/Code/GameEngine/Source/Common/GlobalData.cpp`: `GlobalData::init`
  sets the runtime defaults (`m_xResolution`, `m_antiAliasLevel`,
  `m_textureFilteringMode`, `m_textureAnisotropyLevel`, `m_terrainLOD`,
  `m_enableDynamicLOD`), then `loadFromINI` overrides them from
  `OptionPreferences`.
* `Core/GameEngine/Source/Common/OptionPreferences.cpp`: `getResolution`,
  `getAntiAliasing`, `getTextureFilterMode`, `getTextureAnisotropyLevel` are
  the saved-preference readers. They currently hardcode their own fallbacks
  (none/bilinear/2x) even when the key is absent.
* `GeneralsMD/Code/GameEngine/Source/Common/GameLOD.cpp`:
  `GameLODManager::init`, `getStaticGameDetail`, `setStaticLODLevel`,
  `applyStaticLODLevel` and the `StaticGameLODNames` table.
* `GeneralsMD/Code/Main/SDL3Main.cpp`: the 1024x768 bootstrap window.
* `Core/Libraries/Source/WWVegas/WW3D2/ww3d.h` and `texturefilter.h`: the
  MSAA and texture-filter enums. The WebGPU backend accepts only 4x MSAA
  (`CheckDeviceMultiSampleType`).
* `web/tests/helpers/launcher.ts`, `web/tests/harness/canvas/hd.js` (new),
  `web/tests/launcher.spec.ts` for the real-engine-with-synthetic-archives
  flow.

## Contract

### Web defaults, fresh profile only

These apply in the `__EMSCRIPTEN__` build only. A key present in `Options.ini`
always wins, including `Resolution`, `StaticGameLOD`, `AntiAliasing`,
`TextureFilter` and `AnisotropyLevel`.

* `GlobalData::init` under `__EMSCRIPTEN__`:
  * `m_xResolution = 1920`, `m_yResolution = 1080` (native stays
    `DEFAULT_DISPLAY_WIDTH/HEIGHT`).
  * `m_antiAliasLevel = WW3D::MULTISAMPLE_MODE_4X`.
  * `m_textureFilteringMode = TextureFilterClass::TEXTURE_FILTER_ANISOTROPIC`.
  * `m_textureAnisotropyLevel = TEXTURE_FILTER_ANISOTROPIC_16X`.
  * `m_terrainLOD = TERRAIN_LOD_MAX`.
  * `m_enableDynamicLOD = FALSE`.
  * The existing advanced lighting/shadow/post-processing defaults stay as
    they are (already enabled).
* `OptionPreferences::getAntiAliasing`, `getTextureFilterMode` and
  `getTextureAnisotropyLevel` return the current `TheGlobalData` value when
  their key is absent, instead of hardcoded none/bilinear/2x. Native values
  are unchanged because native `GlobalData` keeps the old defaults.
* `OptionPreferences::getResolution` already falls back to
  `TheGlobalData->m_xResolution/m_yResolution`, so the GlobalData change is
  enough for the no-key case.
* `GameLODManager::init`: on `__EMSCRIPTEN__`, when `OptionPreferences` has no
  `StaticGameLOD` key, force `userSetDetail = STATIC_GAME_LOD_VERY_HIGH` and
  `m_idealDetailLevel = STATIC_GAME_LOD_VERY_HIGH`. After applying it, set
  `TheWritableGlobalData->m_enableDynamicLOD = FALSE` for that defaulted case.
  If `StaticGameLOD` is present, keep the player's choice and do not touch
  dynamic LOD.
* `SDL3Main.cpp`: the bootstrap `SDL_CreateWindow` size is 1920x1080 under
  `SAGE_USE_WEBGPU`; native keeps 1024x768. The final render size still comes
  from the engine options.
* After `setStaticLODLevel` in `GameLODManager::init`, under `__EMSCRIPTEN__`,
  print exactly one line to stderr:

  `GENERALSX_GRAPHICS xres=<w> yres=<h> lod=<VeryHigh|High|Medium|Low|Custom> aa=<int> filter=<int> anisotropy=<int> dynamicLOD=<0|1>`

  using the values from `TheGlobalData`. `filter` is the
  `TextureFilterClass::TextureFilterMode` int (Anisotropic = 4) and
  `anisotropy` the int (16 = 16x). The page already records stderr in
  `window.__zhwpLog`.

### Page

The page and its layout code are unchanged: it fits whatever drawing buffer
the engine sets below the top bar. A 1920x1080 buffer must display without page
scroll at 1280x800 (width-limited, 1280x720 at y=56) and at 1920x1080
(height-limited to 1024 px tall, about 1820 px wide and centred, because the
56 px top bar leaves 1024 px), keeping the aspect ratio.

## Acceptance criteria

1. On a fresh web profile with synthetic archives, the real engine logs exactly one `GENERALSX_GRAPHICS xres=1920 yres=1080 lod=VeryHigh aa=4 filter=4 anisotropy=16 dynamicLOD=0` line.
2. In that run `#canvas.width` is 1920 and `#canvas.height` is 1080, even if the engine later fails on the synthetic assets.
3. With a fake engine that sets a 1920x1080 buffer, at 1280x800 the page does not scroll, the canvas keeps 16:9, starts at the top bar's bottom (within 1 px), and is 1280 wide.
4. With the same fake engine at 1920x1080, the canvas is height-limited to the viewport minus the top bar (1024 px tall, about 1820 px wide, 16:9), starts at the top bar's bottom, the page does not scroll, and it is horizontally centred.
5. The `GENERALSX_GRAPHICS` line is absent on the old build (the test fails before the implementation).
6. Native builds are unchanged: the new defaults and the log are behind `__EMSCRIPTEN__`, and `DEFAULT_DISPLAY_WIDTH/HEIGHT` remain 1024x768.

## Test paths

* `web/tests/launcher-graphics-defaults.spec.ts`: criteria 1, 2, 5. It imports
  the synthetic install with no `module` parameter (the real engine), waits
  for `window.__zhwpLog` to contain `GENERALSX_GRAPHICS`, and checks the values
  and canvas buffer. It must not require real game data.
* `web/tests/launcher-1080p.spec.ts`: criteria 3, 4, using a fake engine that
  sets 1920x1080 and the existing synthetic install.
* `web/tests/harness/canvas/hd.js`: the fake engine.

## Allowed paths

* `GeneralsMD/Code/GameEngine/Source/Common/GlobalData.cpp`
* `Core/GameEngine/Source/Common/OptionPreferences.cpp`
* `GeneralsMD/Code/GameEngine/Source/Common/GameLOD.cpp`
* `GeneralsMD/Code/Main/SDL3Main.cpp`

Tests are written separately. No page/UI change is expected.

## Check

`scripts/build-webgpu.sh` exits 0, then:

`cd web && npm ci && ZHWP_PORT=4193 npx playwright test tests/launcher-graphics-defaults.spec.ts tests/launcher-1080p.spec.ts`

The two specs must pass in Brave. The real-data specs are not needed for this
task; the synthetic archives are enough to reach engine initialization.

## Out of scope

* Forcing the new defaults over an `Options.ini` the player already saved.
* Changing `DEFAULT_DISPLAY_WIDTH/HEIGHT` (the UI design reference).
* Any UI/shell change.
