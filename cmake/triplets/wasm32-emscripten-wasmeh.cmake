# GeneralsX @performance Claude 20/10/2026 wasm32-emscripten with native wasm exceptions and wasm setjmp, for
# the JSPI build (ZHWP_WEB_JSPI). libpng uses setjmp; mixing its Emscripten-style invoke_* imports with
# -sSUPPORT_LONGJMP=wasm does not link.
include("${VCPKG_ROOT_DIR}/triplets/community/wasm32-emscripten.cmake")
set(VCPKG_C_FLAGS "-fwasm-exceptions -sSUPPORT_LONGJMP=wasm")
set(VCPKG_CXX_FLAGS "-fwasm-exceptions -sSUPPORT_LONGJMP=wasm")
