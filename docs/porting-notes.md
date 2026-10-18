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
