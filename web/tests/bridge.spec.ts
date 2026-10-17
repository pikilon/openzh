import { test, expect, type Page } from "@playwright/test";

const SIZE = 9 * 1024 * 1024 + 123; // more than two 4 MiB transfer blocks

async function open(page: Page) {
  await page.goto("/harness/index.html");
  await page.waitForFunction(() => (window as unknown as { zhwpReady?: boolean }).zhwpReady === true);
}

test("the page is cross-origin isolated (SharedArrayBuffer available)", async ({ page }) => {
  await open(page);
  expect(await page.evaluate(() => crossOriginIsolated && typeof SharedArrayBuffer === "function")).toBe(true);
});

test("synchronous reads return exactly the stored bytes", async ({ page }) => {
  await open(page);
  const outcome = await page.evaluate(async (size) => {
    const z = (window as any).zhwp;
    // Deterministic content: xorshift32 bytes.
    const data = new Uint8Array(size);
    let s = 0x9e3779b9;
    for (let i = 0; i < size; i++) {
      s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
      data[i] = s & 0xff;
    }
    await z.clearStored();
    await z.storeFiles([{ kind: "zh", name: "TexturesZH.big", file: new Blob([data]) }]);
    const bridge = await z.FileBridge.start(await z.listStored());
    const errors: string[] = [];
    const check = (pos: number, len: number) => {
      const out = new Uint8Array(len);
      const n = bridge.readSync("zh", "TexturesZH.big", pos, out);
      const expected = Math.max(0, Math.min(len, size - pos));
      if (n !== expected) { errors.push(`read(${pos},${len}) returned ${n}, expected ${expected}`); return; }
      for (let i = 0; i < n; i++) {
        if (out[i] !== data[pos + i]) { errors.push(`byte ${pos + i} differs`); return; }
      }
    };
    let r = 12345;
    for (let k = 0; k < 200; k++) {
      r = (r * 1103515245 + 12345) >>> 0;
      const pos = r % size;
      r = (r * 1103515245 + 12345) >>> 0;
      check(pos, 1 + (r % (300 * 1024)));
    }
    check(0, 6 * 1024 * 1024 + 7);         // one call spanning transfer blocks
    check(size - 10, 100);                  // short read at the end
    check(size, 16);                        // at EOF: 0 bytes
    check(size + 1000, 16);                 // past EOF: 0 bytes
    const reportedSize = bridge.size("zh", "TexturesZH.big");
    let unknownThrows = false;
    try { bridge.readSync("zh", "Nope.big", 0, new Uint8Array(4)); } catch { unknownThrows = true; }
    await bridge.close();
    return { errors, reportedSize, unknownThrows };
  }, SIZE);
  expect(outcome.errors).toEqual([]);
  expect(outcome.reportedSize).toBe(SIZE);
  expect(outcome.unknownThrows).toBe(true);
});
