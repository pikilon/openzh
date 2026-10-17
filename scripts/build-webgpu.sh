#!/usr/bin/env bash
# Builds the browser engine (GeneralsXZH.js + .wasm) with the `webgpu` preset.
# Requirements: emscripten, cmake, ninja, pkg-config, and a vcpkg checkout in
# VCPKG_ROOT. See docs/porting-notes.md for the known toolchain pitfalls.
#
# Usage: scripts/build-webgpu.sh [--clean]
# Exit 0 when build/webgpu/GeneralsMD/GeneralsXZH.wasm was produced.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

export PATH="/opt/homebrew/bin:$PATH"
emcc_path="$(command -v emcc)" || { echo "emcc not found: install emscripten" >&2; exit 2; }
: "${EMSCRIPTEN_ROOT:=$(cd "$(dirname "$(readlink -f "$emcc_path")")" && pwd)}"
[ -f "$EMSCRIPTEN_ROOT/cmake/Modules/Platform/Emscripten.cmake" ] || EMSCRIPTEN_ROOT="$(brew --prefix emscripten)/libexec"
export EMSCRIPTEN_ROOT
export EM_LLVM_ROOT="${EM_LLVM_ROOT:-$EMSCRIPTEN_ROOT/llvm/bin}"
export EM_BINARYEN_ROOT="${EM_BINARYEN_ROOT:-$EMSCRIPTEN_ROOT/binaryen}"
: "${VCPKG_ROOT:?set VCPKG_ROOT to a vcpkg checkout}"
export VCPKG_ROOT

if [ "${1:-}" = "--clean" ]; then rm -rf build/webgpu; fi
cmake --preset webgpu -DCMAKE_MAKE_PROGRAM="$(command -v ninja)"
ninja -C build/webgpu z_generals
test -f build/webgpu/GeneralsMD/GeneralsXZH.wasm
echo "Built build/webgpu/GeneralsMD/GeneralsXZH.{js,wasm}"
