import config from "./playwright.config";

// Benchmarks: same server and browsers as the tests, but only bench/ files.
export default { ...config, testDir: "bench", testMatch: "*.bench.ts", reporter: [["list"]] };
