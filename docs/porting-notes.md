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
