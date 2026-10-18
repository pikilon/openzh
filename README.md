<h1 align="center">OpenZH</h1>

<p align="center">
  <strong>The Command &amp; Conquer: Generals / Zero Hour engine, running in the browser.</strong>
</p>

<p align="center">
  Built from EA's GPL-3.0 source release. Ships no game assets: it reads the copy of the game you already own.
</p>

> **Status: early.** The engine builds to WebAssembly, starts in the browser, imports your game ZIP files and reaches the main menu. It is not yet playable end to end; see [the plan](docs/plan.md).

## What this is

OpenZH is a browser port of the engine behind *Command & Conquer: Generals* and
*Zero Hour*. The original C++ compiles to WebAssembly with Emscripten; rendering
goes through WebGPU behind the engine's existing `DX8Wrapper`, so the game code
is the game code, not a reimplementation.

It is a port, not a remake: the goal is the original game, unchanged, in a tab.

## What you need

* **Your own copy of the game.** OpenZH contains no models, textures, audio,
  maps or strings. You pack your install (Steam, EA App, The First Decade or the
  retail discs) into ZIP files with `web/scripts/make-game-zip.mjs` and load
  them; the files stay on your machine.
* **A desktop browser with WebGPU** (current Chrome, Edge or Brave) and
  `SharedArrayBuffer`, which means the page needs COOP/COEP headers.

## Running it

```sh
scripts/build-webgpu.sh          # builds the engine to WebAssembly
cd web && npm ci && npm run dev  # serves the launcher
```

Pick or drop the game ZIP files in the launcher: they stay in the browser, nothing is uploaded, and the page remembers them for next time. Browser tests run with `cd web && npx playwright test`.

## Documentation

* [`docs/plan.md`](docs/plan.md) — phases and where the project is.
* [`docs/decisions.md`](docs/decisions.md) — D-01 to D-10, the binding decisions.
* [`docs/base-evaluation.md`](docs/base-evaluation.md) — why this base.
* [`docs/porting-notes.md`](docs/porting-notes.md) — recurring classes of bug.

## Lineage

This project stands on other people's work:

* **Westwood Studios and EA** for the game and for releasing the engine source
  under GPL-3.0.
* **[TheSuperHackers](https://github.com/TheSuperHackers/GeneralsGameCode)** for
  the modernised, maintained codebase this descends from.
* **[GeneralsX](https://github.com/fbraz3/GeneralsX)** for the SDL3, macOS and
  cross-platform work, and for the fork this repository starts from.
* **[wasm-generals](https://github.com/origami-ltd/wasm-generals)** for the
  WebGPU translation of the D3D8 layer, ported in under GPL-3.0.

## License

Code is **GPL-3.0**, inherited from EA's source release and the bases above. See
[`LICENSE.md`](LICENSE.md).

OpenZH is not affiliated with, sponsored or endorsed by Electronic Arts.
*Command & Conquer*, *Generals* and *Zero Hour* are trademarks of Electronic
Arts Inc. The names appear here only to say which game this port runs.
