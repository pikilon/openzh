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
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], launchOptions: { args: ["--enable-unsafe-webgpu"] } },
    },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
  ],
});
