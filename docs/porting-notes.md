# Porting Notes

One entry per recurring class of problem: its cause and the fix to apply
when it shows up again. Add an entry before closing the issue that found it.

## Build toolchain

### `pkg-config` missing during the Emscripten configure

* Cause: vcpkg's `vcpkg_fixup_pkgconfig` needs `pkg-config` on the host; the
  wasm-generals instructions do not list it.
* Fix: `brew install pkg-config` (macOS) before `cmake --preset webgpu`.

### Ninja not found from non-interactive shells

* Cause: `/opt/homebrew/bin` is not on `PATH` in some agent or CI shells.
* Fix: export `PATH=/opt/homebrew/bin:$PATH` or pass
  `-DCMAKE_MAKE_PROGRAM=/opt/homebrew/bin/ninja`.

## File paths

### Port patches against files that upstream moved to `Core/`

* Cause: TheSuperHackers keeps unifying `Generals/` and `GeneralsMD/` copies
  into `Core/` (for example `W3DDisplay.cpp`, `Shell.cpp`, `Diplomacy.cpp`,
  `InGameChat.cpp`). A patch made against an older GeneralsX names the old
  per-game paths and `git apply` aborts.
* Fix: rewrite the Zero Hour (`GeneralsMD/`) side of the patch to the `Core/`
  path and apply it with `git apply --3way` (the base blob is in our history);
  drop the `Generals/` side, which the unified file already covers.

## Platform libraries

### fontconfig does not exist in the browser

* Cause: `render2dsentence` resolves fonts through fontconfig on Linux and
  macOS; Emscripten has no fontconfig.
* Fix: treat `__EMSCRIPTEN__` like iOS in the fontconfig guards; upstream's
  tiered lookup then falls back to bundled fonts, and the WebGPU build uses
  `/fonts/GeneralsX.ttf` when nothing else resolves.

## Browser file access

### The main thread spins while the archive bridge reads

* Cause: `Atomics.wait` is forbidden on the main thread, so `FileBridge`
  busy-waits on `Atomics.load` for the worker's answer (D-03). If the worker
  dies mid-request, the page freezes.
* Fix (issue #13): every wait has a time limit (`readTimeoutMs`, default
  10 s); on time-out `readSync` throws, the worker is terminated and the
  bridge refuses further reads, so the engine sees a read error instead of a
  frozen tab.

### File bridge throughput (measured, not a bug)

* `cd web && npm run bench` (1 GiB file in OPFS), 2026-10-17, M2 Max, headless
  Playwright profiles, warm OS cache:
  * Brave 155: 64 KiB random reads 162 µs each (about 6,200/s); 32 MiB
    sequential reads 3.3 GB/s; import 0.66 GB/s (256 MiB in-memory Blob).
  * Earlier run, before D-04: Playwright Chromium 150 µs, 3.4 GB/s;
    Firefox 46 µs, 6.3 GB/s.
* Brave cannot read a composed in-memory Blob of 1 GiB in a temporary profile
  (`NotReadableError`), so the bench writes its big file straight into OPFS.
  Real imports use disk-backed `File`s from the picker and are not affected.
* The bridge is not the bottleneck at these numbers, so D-03 stands. Re-run
  with real archives and a cold cache before drawing conclusions about load
  times.

## Frame-time baseline (issue #36)
* `cd web && ZHWP_REPLAY=<file.rep> npm run bench -- real-replay` (needs `ZHWP_GAME_DIR`), 2026-10-18, M2 Max, Brave headless, the owner's Zero Hour 1.04 files, `linux_2p_vanilla_map.rep` from GeneralsXReplays (game resumed with `P` after its expected CRC pause at frame 100), 60 s of play after warm-up.
* `FRAME_BASELINE {"frames":3601,"p50":16.67,"p95":16.67,"p99":16.67,"max":16.67,"over33ms":0}`: no dropped frame. The engine's own counter reads `60[30]` (render 60 fps, logic 30) at 1024x768.
* Limits: headless `requestAnimationFrame` is a fixed 60 Hz clock, so this shows no stalls on the main thread, not how heavy a late-game battle is. A 2-player replay of 3 minutes is a light load; a 6-player replay (needs its custom map in the user data folder) and a windowed run on the owner's screen would be the next measurement. Phase 1 needs no performance work on this evidence.

## Mobile frame time: transform and lighting on the GPU (2026-10-20)
* Device: the owner's RedMagic NX733J (Snapdragon 8 Elite), Brave, shell map behind the main menu, canvas 1920x1080. Before: 8-10 fps, with ~60 % of the main thread in `WebGPUD3DDevice::convertVertex` and ~15 % in `draw`. The Direct3D 8 emulator transformed and lit ~290 000 vertices per frame on the CPU and uploaded them as 68-byte `CanonicalVertex`es (~20 MB per frame, ~2 700 draws).
* Now fixed-function draws run in `vertex_ff` (WGSL in `WebGPUD3D8.cpp`, a step-for-step copy of `convertVertex`). Vertex and index buffers keep a GPU copy (`GpuBufferMirror`) that is uploaded only when locked, so static geometry costs nothing per frame. The CPU path is left for the programmable vertex shader (`Trees.vso`, ~4 500 vertices per frame) and for upload overflow. Result: 34-40 fps on the same menu. Audio adds ~9 % of the main thread when playing (MP3 decode and resampling in `ScriptProcessorNode`); switching it off with `-noaudio` gave no measurable fps change.
* Uploads to a mirror are queued and land before the whole frame's commands. The game rewrites bytes that an earlier draw of the same frame read, even under `D3DLOCK_NOOVERWRITE` (shadow volumes do this), so the mirror tracks the bytes read this frame. A draw whose bytes changed after use copies its vertices instead, a DISCARD lock moves the mirror to a new buffer, and pending uploads are written out at the next `Lock` whose range touches them, before the game changes the memory. Missing any of these shows as stray shadow bands, or units drawn with another frame's vertices.
* Upload volume: `queue.writeBuffer` costs about 1 ms per MB on the phone, the number of calls matters little. The dynamic buffers are filled by `D3DLOCK_NOOVERWRITE` appends; flushing at every `Lock` sent one write per append (~400 per frame). Now pending ranges that touch merge into one write, and a `Lock` that does not touch them leaves them queued (a range with a gap is written out first: the gap's bytes may have changed after a draw read them). Buffers rewritten every frame keep a `shadow` of what the GPU holds and send only changed 256-byte blocks; so does the per-frame uniform upload buffer, against its contents from the frame that last used it (~90 % unchanged). The fixed-function upload buffer is written whole: its blocks shift offset between frames, and diffing it cost more (compare plus ~300 small writes) than it saved. A buffer that replaced a DISCARDed one gets no shadow (its other bytes are unknown). Phone, main menu: 5.4 MB and ~4.5-5.8 ms of `writeBuffer` per frame before, ~2.9 MB and ~2 ms after (uploads including the comparisons: ~13-15 % of the main thread down to ~9.5 %); most of the rest is the dynamic vertex ring (new vertices every frame) and the fixed-function blocks. Frozen-time checks unchanged: GPU vs GPU identical, CPU vs GPU 0.007-0.014 % of pixels (>2 levels) at 8-50 s, the same as the build before.
* Checking: `?cputnl=1`, or `globalThis.zhwpCpuTnl = true` at run time, keeps transform and lighting on the CPU. To compare the paths, freeze `performance.now` and `Date.now` in the page: the shell map stops, but the frame keeps being drawn, so one frame can be captured with each path. CPU vs GPU then differs in under 0.01 % of pixels (rounding at edges). `-DZHWP_VERIFY_VERTEX` still compares the CPU conversion with the original code bit for bit (it forces the CPU path).
* Programmable vertex shaders (vs.1.1, only `Trees.vso` in practice) are translated to WGSL the first time they draw (`vertexShaderWgsl`, entry point `vertex_vs`, a step-for-step copy of `executeVertexShader`) and read their vertices from the buffer mirrors like `vertex_ff`. The 96 constant registers and the viewport size go per draw in the group 1 uniform stream, whose binding grew to fit them (`kGroup1BindingSize`). A program whose declaration reads past the vertex stays on the CPU interpreter, as does everything with `?cputnl=1`. Phone, main menu: `convertVertexChecked` (~8 % of the main thread) is gone and the menu went from ~37 to ~44 fps in interleaved runs; frozen-time CPU vs GPU stays at 0.006-0.013 % of pixels.
* Bind groups (samplers, texture views and the frame's uniform buffer) stay cached across frames in each upload frame instead of being rebuilt every time the frame is reused (~110 `createBindGroup` per frame before, none now in the menu). The cache keys on view pointers, so a texture that goes away drops its entries first (`forgetTextureView`); a cap of 4096 per upload frame bounds the rest. Phone, main menu: bind group work from ~7 % to ~4.5 % of the main thread, ~44 to ~47.6 fps in interleaved runs.
* Square roots: GameMath's `gm_sqrtf` (fdlibm, bit by bit, kept for replay and multiplayer determinism) cost ~4.8 % of the main thread on the phone, mostly terrain dynamic lighting and shadows. It is correctly rounded, like WebAssembly's `f32.sqrt`; an exhaustive check over every positive finite float found no differing bit, so `gm_sqrtf_fast` (WWMath/wwmath.h, and `Sqrt` in Lib/Trig.cpp) uses the instruction for those inputs and keeps `gm_sqrtf` for zero, negatives, NaN and infinity. Phone, main menu: ~0.6 % left (GameMath's own internal calls), ~44.8 to ~49.8 fps in interleaved runs.
* Profiling a wasm build needs the `.symbols` file of the same link (`--emit-symbol-map`); function indices change between builds.
* Audio (miniaudio mixes on the main thread through a `ScriptProcessorNode`): the engine now runs at 44.1 kHz, the rate of the music and speech, instead of the AudioContext's default 48 kHz; the browser converts to the hardware rate off the main thread. Sound effects, mostly 22.05 kHz MP3s replayed constantly, were decoded and resampled again on every play; now recently played effects stay decoded at 44.1 kHz (`holdDecodedEffect`, the role of the Miles backend's `AudioFileCache`, budget twice `AudioFootprintInBytes`). Nothing sets a pitch or a velocity, so sounds and groups run with `MA_SOUND_FLAG_NO_PITCH`. On the phone, MP3 decoding plus resampling went from ~5 % of the main thread to under 1 %, the rest being the first decode of each effect. The output was compared before and after by wrapping `onaudioprocess`: same loudness per 2 s window and the same spectral centroid in Hz.
* JSPI instead of ASYNCIFY, native wasm exceptions instead of JS ones (`ZHWP_WEB_JSPI`, ON in the `webgpu` preset). ASYNCIFY without a list instruments almost every function, since any indirect call may reach a sleep, and with JS exceptions every call that may throw inside a function with cleanups leaves wasm through `invoke_*` (stackSave, try/catch, `dynCall_*`, ASYNCIFY's export wrapper and `maybeStopUnwind`). Under JSPI only an export listed in `JSPI_EXPORTS` (`main`, `GeneralsXPump`) may suspend, and emscripten's main loop calls its callback from JS, so `SDL3GameEngine::execute` runs the loop inside `main` and sleeps until the next 16 ms tick (the old `EM_TIMING_SETTIMEOUT` pacing). `run()` awaits `main` under JSPI, so `cmake/webgpu-jspi-pre.js` starts `main` from the first `postRun` without waiting: the module factory resolves when `main` first suspends, as it did with ASYNCIFY. The vcpkg dependencies use the `wasm32-emscripten-wasmeh` triplet (`-fwasm-exceptions -sSUPPORT_LONGJMP=wasm`; libpng uses setjmp). The page lists `WebAssembly JSPI` (`WebAssembly.Suspending`, Chromium 137+) among the required features. Phone, main menu, three interleaved rounds: ~45 fps (47.5, 39.8, 46.8) to ~55 fps (55.6, 55.3, 55.3); the trampoline and wrapper share of the busy main thread went from ~9 % to ~1.5 % (what is left is `wasm-to-js` into WebGPU). The wasm went from 17.5 to 9.3 MB. On the Mac, a 3000-frame bot match averages 1.53 ms per frame instead of 2.0. Checked: every `real-data*` spec, the full web suite, starting a map (the load screen sleeps), sound after a real CDP click on `#mute`, and `GeneralsXPump` (returns a Promise, advances frames). Replay determinism: a recorded replay paused at frames 1800, 2900 and 8900 saves the same `CHUNK_GameLogic` in both builds, apart from `PhysicsBehavior::m_velMag`, a lazy cache (-1 until someone asks). The build compiles with `-ffp-contract=off` and no fast-math, so float results do not depend on codegen. `GameLogic::getCRC` returns the same value (87023EFF) at every frame in these builds, so CRC lines cannot show a desync here.
