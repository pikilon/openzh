import { test } from "@playwright/test";

// Throughput of FileBridge on a large OPFS file (D-03 asks to revisit the
// design if it is too slow). Not part of `npm test`: run `npm run bench`.
// Prints one JSON line per browser; record the numbers in docs/porting-notes.md.

const SIZE = 1024 * 1024 * 1024; // 1 GiB

test("file bridge throughput", async ({ page, browserName }) => {
  test.setTimeout(600_000);
  await page.goto("/harness/index.html");
  await page.waitForFunction(() => (window as unknown as { zhwpReady?: boolean }).zhwpReady === true);
  const result = await page.evaluate(async (size) => {
    const z = (window as any).zhwp;
    await z.clearStored();
    const chunk = new Uint8Array(16 * 1024 * 1024);
    for (let i = 0; i < chunk.length; i++) chunk[i] = i & 0xff;
    const parts: Blob[] = [];
    for (let done = 0; done < size; done += chunk.length) parts.push(new Blob([chunk]));
    let t = performance.now();
    await z.storeFiles([{ kind: "zh", name: "BenchZH.big", file: new Blob(parts) }]);
    const importMBs = size / 1048576 / ((performance.now() - t) / 1000);
    const bridge = await z.FileBridge.start(await z.listStored());

    const small = new Uint8Array(64 * 1024);
    let r = 1;
    const reads = 5000;
    t = performance.now();
    for (let i = 0; i < reads; i++) {
      r = (r * 1103515245 + 12345) >>> 0;
      bridge.readSync("zh", "BenchZH.big", r % (size - small.length), small);
    }
    const randomMs = performance.now() - t;

    const big = new Uint8Array(32 * 1024 * 1024);
    t = performance.now();
    for (let pos = 0; pos < 512 * 1024 * 1024; pos += big.length) bridge.readSync("zh", "BenchZH.big", pos, big);
    const seqMBs = 512 / ((performance.now() - t) / 1000);

    await bridge.close();
    await z.clearStored();
    return {
      importMBs: Math.round(importMBs),
      random64KiBReadsPerS: Math.round(reads / (randomMs / 1000)),
      random64KiBMeanUs: Math.round((randomMs * 1000) / reads),
      sequentialMBs: Math.round(seqMBs),
    };
  }, SIZE);
  console.log(JSON.stringify({ browser: browserName, ...result }));
});
