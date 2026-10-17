# 3a: Make the ported WebGPU backend compile against current GeneralsX

Part of issue #3. The engine changes ported from `origami-ltd/wasm-generals`
were written against an older GeneralsX (2026-08-03); three call sites no
longer match today's upstream APIs.

## Read first
* The three error locations below and the upstream declarations they name.

## Errors to fix (from `scripts/build-webgpu.sh`)
1. `Core/GameEngineDevice/Include/NullAudioDevice/NullAudioManager.h:64`:
   `has3DSensitiveStreamsPlaying() const override` — the base `AudioManager`
   no longer declares this virtual. Make `NullAudioManager` match the current
   `AudioManager` interface (`Core/GameEngine/Include/Common/GameAudio.h`):
   drop overrides of methods that no longer exist and add any pure virtuals
   that are now required, with no-op bodies like the rest of the class.
2. `GeneralsMD/Code/GameEngineDevice/Source/SDL3GameEngine.cpp:204`:
   `TheArchiveFileSystem->getArchiveFile(path)` is protected now. Use the
   public `ArchiveFileSystem` API that upstream code uses for the same
   purpose (search for other callers); do not change `ArchiveFileSystem`.
3. `Core/GameEngineDevice/Source/W3DDevice/GameClient/W3DDisplay.cpp:2403`:
   `GameState::saveGame` returns `SaveResult` now, not `SaveCode`. Adapt the
   caller to the new return type, keeping its behaviour (it checks whether
   the save succeeded).

## Rules
* Adapt the ported code to upstream; never change upstream declarations.
* Keep the existing `// GeneralsX @... Codex ...` annotations; add
  `// GeneralsX @build 17/10/2026 <why>` on lines you change.
* You cannot run the full build. The lead agent runs it and sends you any
  remaining errors.

## Check
`scripts/build-webgpu.sh` exits 0 (run by the lead agent).

## Allowed paths
* `Core/GameEngineDevice/Include/NullAudioDevice/NullAudioManager.h`
* `GeneralsMD/Code/GameEngineDevice/Source/SDL3GameEngine.cpp`
* `Core/GameEngineDevice/Source/W3DDevice/GameClient/W3DDisplay.cpp`
