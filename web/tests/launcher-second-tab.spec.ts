import { test, expect } from "@playwright/test";
import { clearStored, launcherUrl, START_TIMEOUT, waitForState } from "./helpers/launcher";
import { installZip } from "./helpers/install-zip";

// The stored archives can be open in one page only (OPFS sync access handles).
// A second OpenZH tab used to fail with a raw NoModificationAllowedError, and
// Retry could never recover because the failed start kept its handles open.
// The launcher now holds a Web Lock while the engine runs: a second tab shows a
// clear message, and Retry works once the first tab is gone.

const RESOLVES = "/harness/errors/resolves.js";

test("a second tab explains the files are in use, and Retry starts once the first tab closes", async ({
  context,
}, info) => {
  const first = await context.newPage();
  await clearStored(first);
  await first.goto(launcherUrl(RESOLVES));
  await waitForState(first, "no-assets");
  await first.locator("#zip-input").setInputFiles(await installZip(info.outputPath()));
  await waitForState(first, "playing", START_TIMEOUT);

  const second = await context.newPage();
  await second.goto(launcherUrl(RESOLVES));
  await waitForState(second, "error", START_TIMEOUT);
  await expect(second.locator("#engine-error")).toContainText("another OpenZH tab or window");
  await expect(second.locator("#engine-error")).not.toContainText("NoModificationAllowedError");

  await first.close();
  await second.locator("#retry").click();
  await waitForState(second, "playing", START_TIMEOUT);
});
