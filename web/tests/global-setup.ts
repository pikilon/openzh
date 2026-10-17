import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

export default function globalSetup() {
  const wasm = fileURLToPath(new URL("../../build/webgpu/GeneralsMD/GeneralsXZH.wasm", import.meta.url));
  if (!existsSync(wasm)) {
    throw new Error(`Engine build missing at ${wasm}. Run scripts/build-webgpu.sh from the repository root first.`);
  }
}
