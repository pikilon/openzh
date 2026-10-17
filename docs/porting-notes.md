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
  * Chromium: 64 KiB random reads 150 µs each (about 6,700/s); 32 MiB
    sequential reads 3.4 GB/s; import 0.9 GB/s.
  * Firefox: 46 µs each (about 21,700/s); 6.3 GB/s; import 3.2 GB/s.
* The bridge is not the bottleneck at these numbers, so D-03 stands. Re-run
  with real archives and a cold cache before drawing conclusions about load
  times.
