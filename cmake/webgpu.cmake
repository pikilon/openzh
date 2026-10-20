# GeneralsX @feature Codex 04/08/2026 Define the shared Emscripten WebGPU contract.
if(NOT EMSCRIPTEN)
    message(FATAL_ERROR "WebGPU browser builds require Emscripten")
endif()

# GeneralsX @performance Claude 20/10/2026 JSPI instead of ASYNCIFY, and native wasm exceptions instead of
# JS-based ones. ASYNCIFY instruments nearly every function (any indirect call might reach a sleep), and with
# JS exceptions every call that may throw inside a function with cleanups leaves wasm through an invoke_*
# trampoline. JSPI suspends the wasm stack in the engine instead, so the code runs uninstrumented. The vcpkg
# dependencies must use the same exception and setjmp model, hence the wasm32-emscripten-wasmeh triplet.
# Phone, main menu: ~45 -> ~55 fps; the ASYNCIFY and invoke_* overhead was ~9 % of the main thread.
option(ZHWP_WEB_JSPI "Use JSPI and native wasm exceptions instead of ASYNCIFY and JS exceptions" ON)
if(ZHWP_WEB_JSPI)
    if(NOT VCPKG_TARGET_TRIPLET STREQUAL "wasm32-emscripten-wasmeh")
        message(FATAL_ERROR "ZHWP_WEB_JSPI needs -DVCPKG_TARGET_TRIPLET=wasm32-emscripten-wasmeh")
    endif()
    set(ZHWP_WEB_EXCEPTIONS -fwasm-exceptions)
    set(ZHWP_WEB_LONGJMP wasm)
    add_compile_definitions(ZHWP_WEB_JSPI=1)
else()
    if(VCPKG_TARGET_TRIPLET STREQUAL "wasm32-emscripten-wasmeh")
        message(FATAL_ERROR "ZHWP_WEB_JSPI=OFF needs -DVCPKG_TARGET_TRIPLET=wasm32-emscripten")
    endif()
    set(ZHWP_WEB_EXCEPTIONS -fexceptions)
    set(ZHWP_WEB_LONGJMP emscripten)
endif()

# GeneralsX @build Codex 04/08/2026 Keep the browser runtime single-threaded until game work is explicitly moved to workers.
add_compile_options(${ZHWP_WEB_EXCEPTIONS})

add_library(webgpu_runtime INTERFACE)
target_compile_definitions(webgpu_runtime INTERFACE SAGE_USE_WEBGPU)
target_compile_options(webgpu_runtime INTERFACE
    --use-port=emdawnwebgpu
    ${ZHWP_WEB_EXCEPTIONS}
)
target_link_options(webgpu_runtime INTERFACE
    --use-port=emdawnwebgpu
    ${ZHWP_WEB_EXCEPTIONS}
    "-sSUPPORT_LONGJMP=${ZHWP_WEB_LONGJMP}"
    # GeneralsX @port Codex 04/08/2026 Match the native process stack required by legacy global-data initialization.
    "-sSTACK_SIZE=1048576"
    # GeneralsX @build Codex 05/08/2026 Fixed 2 GiB heap. Do NOT raise: growth detaches emdawnwebgpu heap views
    # (black canvas), resizable buffers break TextDecoder, and >2GiB heaps hit signed-pointer casts all over this
    # 2003 codebase (also black canvas). More memory = MEMORY64 rebuild + pointer audit, tracked separately.
    "-sINITIAL_MEMORY=2147483648"
    # GeneralsX @feature Codex 05/08/2026 IDBFS keeps the user data dir (Options.ini, saves) across page loads.
    "-lidbfs.js"
)
if(ZHWP_WEB_JSPI)
    # GeneralsX @performance Claude 20/10/2026 Only exports listed here may suspend: main runs the frame loop
    # (SDL3GameEngine::execute), and GeneralsXPump runs frames while the tab is hidden.
    target_link_options(webgpu_runtime INTERFACE "-sJSPI=1" "-sJSPI_EXPORTS=['main','GeneralsXPump']"
        "SHELL:--pre-js \"${CMAKE_CURRENT_LIST_DIR}/webgpu-jspi-pre.js\"")
else()
    # GeneralsX @feature Codex 04/08/2026 Suspend synchronous legacy initialization while WebGPU requests resolve.
    target_link_options(webgpu_runtime INTERFACE "-sASYNCIFY=1")
endif()
