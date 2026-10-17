import { defineConfig, devices } from "@playwright/test";

// The engine must be built first: scripts/build-webgpu.sh (repository root).
export default defineConfig({
  testDir: "tests",
  timeout: 90_000,
  fullyParallel: false,
  reporter: [["list"]],
  globalSetup: "./tests/global-setup.ts",
  use: { baseURL: "http://127.0.0.1:4173" },
  webServer: {
    command: "npm run serve",
    url: "http://127.0.0.1:4173/smoke/index.html",
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
