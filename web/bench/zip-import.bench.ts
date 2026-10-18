import { test, expect, type TestInfo } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildZip, type BuildZipEntry } from "../tests/helpers/zip";

// Issue #130: the ZIP import must not be meaningfully slower than the folder
// copy of the same bytes (docs/briefs/130-zip-import-speed.md). The benchmark
// builds a 256 MiB synthetic install of four large archives plus 200 small
// files, then times `storeFiles` (the folder path that exists today) against
// `importZips` of a stored-method ZIP and of a deflated ZIP built from the same
// data. Not part of `npm test`: run `npm run bench`.

const MIB = 1024 * 1024;
const ARCHIVE_SIZE = 64 * MIB;
const SMALL_FILES = 200;
const ITERATIONS = 3;
const STORED_LIMIT = 1.25;
const DEFLATED_LIMIT = 2;

const ARCHIVES = [
  { kind: "zh", name: "INIZH.big" },
  { kind: "zh", name: "W3DZH.big" },
  { kind: "generals", name: "INI.big" },
  { kind: "generals", name: "W3D.big" },
] as const;

interface Measurement {
  folderMedian: number;
  zipMedian: number;
  ratio: number;
}

interface MediansFile {
  stored: Measurement;
  deflated: Measurement;
}

// Test 1 measures once in a single browser session; the bound tests read the
// numbers back from the output directory so a failure in one does not restart
// the worker without the measurement (Playwright starts a fresh worker after a
// failed test).
const MEDIANS_FILE = "zip-import-bench.json";

function writeMedians(testInfo: TestInfo, medians: MediansFile): void {
  const dir = testInfo.project.outputDir;
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, MEDIANS_FILE), JSON.stringify(medians));
}

function readMedians(testInfo: TestInfo): MediansFile | undefined {
  try {
    return JSON.parse(readFileSync(join(testInfo.project.outputDir, MEDIANS_FILE), "utf8")) as MediansFile;
  } catch {
    return undefined;
  }
}

// LCG bytes: incompressible enough that the deflated case pays real inflate
// CPU, and deterministic so both ZIPs hold exactly the same data.
function syntheticBytes(size: number, seed: number): Uint8Array {
  const out = new Uint8Array(size);
  let state = seed >>> 0;
  for (let i = 0; i < size; i++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    out[i] = state >>> 24;
  }
  return out;
}

function smallEntries(): BuildZipEntry[] {
  const entries: BuildZipEntry[] = [];
  for (let index = 0; index < SMALL_FILES; index++) {
    entries.push({
      path: `Data/bench/small${String(index).padStart(3, "0")}.bin`,
      data: syntheticBytes(256 + ((index * 37) % 1792), 1000 + index),
      method: "store",
    });
  }
  return entries;
}

async function writeZip(entries: BuildZipEntry[], path: string): Promise<void> {
  const bytes = await buildZip(entries);
  writeFileSync(path, bytes);
}

function ratioOf(measurement: { folderMedian: number; zipMedian: number }): number {
  return measurement.zipMedian / measurement.folderMedian;
}

test("1: build the 256 MiB synthetic install and print folder/ZIP medians and ratio", async ({
  page,
}, testInfo) => {
  test.setTimeout(900_000);

  const dataEntries: BuildZipEntry[] = [
    ...ARCHIVES.map((archive, index) => ({
      path: archive.name,
      data: syntheticBytes(ARCHIVE_SIZE, index + 1),
      method: "store" as const,
    })),
    ...smallEntries(),
  ];
  const storedPath = testInfo.outputPath("bench-stored.zip");
  const deflatedPath = testInfo.outputPath("bench-deflated.zip");
  await writeZip(dataEntries, storedPath);
  await writeZip(
    dataEntries.map((entry) => ({ ...entry, method: "deflate" as const })),
    deflatedPath,
  );

  await page.goto("/harness/index.html");
  await page.waitForFunction(
    () => (window as unknown as { zhwpReady?: boolean }).zhwpReady === true,
  );
  await page.evaluate(() => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.id = "bench-zips";
    input.style.cssText = "position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;";
    document.body.append(input);
  });
  await page.setInputFiles("#bench-zips", [storedPath, deflatedPath]);

  const measured = await page.evaluate(
    async ({ archives, iterations }) => {
      const z = (window as any).zhwp;
      const input = document.getElementById("bench-zips") as HTMLInputElement;
      const picked = Array.from(input.files ?? []);
      const fixture = (name: string): File => {
        const file = picked.find((candidate) => candidate.name === name);
        if (file === undefined) throw new Error(`missing bench fixture ${name}`);
        return file;
      };
      const storedZip = fixture("bench-stored.zip");
      const deflatedZip = fixture("bench-deflated.zip");

      // The folder path gets the archives' exact bytes as blobs: read each
      // local header in the stored ZIP and slice its data out of the same file
      // that `importZips` reads, so both paths copy identical bytes.
      const listed = await z.openZip(storedZip);
      const expectedFiles = listed.filter((entry: any) => entry.isDirectory !== true).length;
      const byPath = new Map<string, any>(listed.map((entry: any) => [entry.path, entry]));
      const source: { kind: string; name: string; file: Blob }[] = [];
      for (const archive of archives) {
        const entry = byPath.get(archive.name);
        if (entry === undefined) throw new Error(`missing archive ${archive.name}`);
        const header = new DataView(
          await storedZip.slice(entry.offset, entry.offset + 30).arrayBuffer(),
        );
        const dataStart =
          entry.offset + 30 + header.getUint16(26, true) + header.getUint16(28, true);
        source.push({
          kind: archive.kind,
          name: archive.name,
          file: storedZip.slice(dataStart, dataStart + entry.size),
        });
      }

      const median = (values: number[]): number => {
        const sorted = [...values].sort((a, b) => a - b);
        return sorted[Math.floor(sorted.length / 2)];
      };
      const runFolder = async (): Promise<number> => {
        await z.clearStored();
        const start = performance.now();
        const result = await z.storeFiles(source);
        if (result.written !== source.length) {
          throw new Error(`folder path wrote ${result.written} of ${source.length} archives`);
        }
        return performance.now() - start;
      };
      const runZip = async (zip: Blob): Promise<number> => {
        await z.clearStored();
        const start = performance.now();
        const result = await z.importZips([zip]);
        if (result.written !== expectedFiles) {
          throw new Error(`ZIP import wrote ${result.written} of ${expectedFiles} files`);
        }
        return performance.now() - start;
      };
      const alternate = async (
        zip: Blob,
      ): Promise<{ folder: number[]; zip: number[] }> => {
        const folder: number[] = [];
        const zipTimes: number[] = [];
        for (let index = 0; index < iterations; index++) {
          if (index % 2 === 0) {
            folder.push(await runFolder());
            zipTimes.push(await runZip(zip));
          } else {
            zipTimes.push(await runZip(zip));
            folder.push(await runFolder());
          }
        }
        return { folder, zip: zipTimes };
      };

      // Warm up both paths before any measured run.
      await runFolder();
      await runZip(storedZip);
      const stored = await alternate(storedZip);

      await runZip(deflatedZip);
      const deflated = await alternate(deflatedZip);

      await z.clearStored();

      return {
        stored: {
          folder: median(stored.folder),
          zip: median(stored.zip),
          folderRuns: stored.folder,
          zipRuns: stored.zip,
        },
        deflated: {
          folder: median(deflated.folder),
          zip: median(deflated.zip),
          folderRuns: deflated.folder,
          zipRuns: deflated.zip,
        },
      };
    },
    { archives: ARCHIVES, iterations: ITERATIONS },
  );

  const storedCase: Measurement = {
    folderMedian: measured.stored.folder,
    zipMedian: measured.stored.zip,
    ratio: ratioOf({ folderMedian: measured.stored.folder, zipMedian: measured.stored.zip }),
  };
  const deflatedCase: Measurement = {
    folderMedian: measured.deflated.folder,
    zipMedian: measured.deflated.zip,
    ratio: ratioOf({ folderMedian: measured.deflated.folder, zipMedian: measured.deflated.zip }),
  };

  writeMedians(testInfo, { stored: storedCase, deflated: deflatedCase });

  console.log(
    `ZIP-IMPORT BENCH stored: folder median ${storedCase.folderMedian.toFixed(1)} ms, ` +
      `ZIP median ${storedCase.zipMedian.toFixed(1)} ms, ratio ${storedCase.ratio.toFixed(2)} ` +
      `(folder runs ${measured.stored.folderRuns.map((value) => value.toFixed(1)).join("/")} ms, ` +
      `ZIP runs ${measured.stored.zipRuns.map((value) => value.toFixed(1)).join("/")} ms)`,
  );
  console.log(
    `ZIP-IMPORT BENCH deflated: folder median ${deflatedCase.folderMedian.toFixed(1)} ms, ` +
      `ZIP median ${deflatedCase.zipMedian.toFixed(1)} ms, ratio ${deflatedCase.ratio.toFixed(2)} ` +
      `(folder runs ${measured.deflated.folderRuns.map((value) => value.toFixed(1)).join("/")} ms, ` +
      `ZIP runs ${measured.deflated.zipRuns.map((value) => value.toFixed(1)).join("/")} ms)`,
  );

  expect(storedCase.folderMedian).toBeGreaterThan(0);
  expect(storedCase.zipMedian).toBeGreaterThan(0);
  expect(deflatedCase.folderMedian).toBeGreaterThan(0);
  expect(deflatedCase.zipMedian).toBeGreaterThan(0);
});

test("2: stored-method ZIP median is at most 1.25 times the folder median", async ({}, testInfo) => {
  const medians = readMedians(testInfo);
  expect(medians, "benchmark test 1 did not produce measurements").toBeDefined();
  const measured = (medians as MediansFile).stored;
  expect(
    measured.ratio,
    `ZIP ${measured.zipMedian.toFixed(1)} ms / folder ${measured.folderMedian.toFixed(1)} ms = ${measured.ratio.toFixed(2)}`,
  ).toBeLessThanOrEqual(STORED_LIMIT);
});

test("3: deflated ZIP median is at most 2 times the folder median", async ({}, testInfo) => {
  const medians = readMedians(testInfo);
  expect(medians, "benchmark test 1 did not produce measurements").toBeDefined();
  const measured = (medians as MediansFile).deflated;
  expect(
    measured.ratio,
    `ZIP ${measured.zipMedian.toFixed(1)} ms / folder ${measured.folderMedian.toFixed(1)} ms = ${measured.ratio.toFixed(2)}`,
  ).toBeLessThanOrEqual(DEFLATED_LIMIT);
});
