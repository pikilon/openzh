import { defineConfig, devices } from "@playwright/test";

// The engine must be built first: scripts/build-webgpu.sh (repository root).
// ZHWP_PORT picks the dev server port (default 4173) so several checkouts can
// run their tests at the same time.
const port = Number(process.env.ZHWP_PORT ?? 4173);

export default defineConfig({
  testDir: "tests",
  timeout: 90_000,
  fullyParallel: false,
  reporter: [["list"]],
  globalSetup: "./tests/global-setup.ts",
  use: { baseURL: `http://127.0.0.1:${port}` },
  webServer: {
    command: `npm run build && node scripts/serve.mjs --port ${port} --mount /smoke=smoke --mount /app=app --mount /engine=../build/webgpu/GeneralsMD --mount /dist=dist --mount /harness=tests/harness`,
    url: `http://127.0.0.1:${port}/smoke/index.html`,
    reuseExistingServer: false,
    timeout: 20_000,
  },
  // Owner's rule (D-04): tests run only in Brave, the browser installed on the
  // owner's machine. Override the binary with BRAVE_PATH.
  projects: [
    {
      name: "brave",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: {
          executablePath: process.env.BRAVE_PATH ?? "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
          args: ["--enable-unsafe-webgpu"],
        },
      },
    },
  ],
});
