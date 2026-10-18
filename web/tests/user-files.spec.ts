import { test, expect, type APIRequestContext, type Page } from "@playwright/test";

// Issue #39: put a replay file into the engine's user data before it starts.
// The tests drive the real engine build through the harness page (or the smoke
// page) and inspect the file system it exposes as window.__zhwpModule.
const DATA = "/home/web_user/.local/share/GeneralsX";
const REPLAY_NAME = "zhwp-synthetic.rep";
const REPLAY_URL = `/harness/replays/${REPLAY_NAME}`;
const STARTED_MILESTONE = "No files read from directory 'Data\\INI\\Default\\GameData'";

type UserFile = { path: string; data: number[] };

function encode(text: string): number[] {
  return Array.from(new TextEncoder().encode(text));
}

// Starts the real engine with plain options (prepare=false) or options from
// prepareEngineOptions (prepare=true), after adding the given user files.
async function startHarnessEngine(page: Page, files: UserFile[], prepare: boolean): Promise<void> {
  await page.goto("/harness/index.html");
  await page.waitForFunction(() => (window as unknown as { zhwpReady?: boolean }).zhwpReady === true);
  await page.evaluate(
    async ({ files, prepare }) => {
      const engine = (await import("/dist/engine.js")) as any;
      if (typeof engine.addUserFiles !== "function") {
        throw new Error("addUserFiles is not exported by /dist/engine.js");
      }
      const { default: createEngine } = (await import("/engine/GeneralsXZH.js")) as any;
      const canvas = document.createElement("canvas");
      canvas.id = "canvas";
      canvas.width = 800;
      canvas.height = 600;
      document.body.append(canvas);

      const w = window as any;
      const log: string[] = [];
      w.__zhwpLog = log;
      w.__zhwpDone = undefined;
      w.__zhwpModule = undefined;
      const options: any = {
        canvas,
        arguments: ["-win"],
        print: (line: string) => log.push(line),
        printErr: (line: string) => log.push(line),
        onAbort: (reason: unknown) => {
          if (w.__zhwpDone?.status === "exited") return;
          w.__zhwpDone = { status: "error", message: String(reason) };
        },
        onExit: (code: number) => {
          w.__zhwpDone = { status: "exited", code };
        },
      };

      let factoryOptions: any = options;
      if (prepare) factoryOptions = await engine.prepareEngineOptions(factoryOptions);
      if (files.length > 0) {
        factoryOptions = engine.addUserFiles(
          factoryOptions,
          files.map((file) => ({ path: file.path, data: new Uint8Array(file.data) })),
        );
      }
      const existing = factoryOptions.preRun ?? [];
      const preRun = typeof existing === "function" ? [existing] : [...existing];
      preRun.push((module: any) => {
        w.__zhwpModule = module;
      });
      factoryOptions = { ...factoryOptions, preRun };

      void createEngine(factoryOptions)
        .then(() => {
          w.__zhwpDone ??= { status: "resolved" };
        })
        .catch((error: unknown) => {
          if (w.__zhwpDone?.status === "exited") return;
          w.__zhwpDone = {
            status: "error",
            message: error instanceof Error ? error.message : String(error),
          };
        });
    },
    { files, prepare },
  );

  await page.waitForFunction(
    () => {
      const w = window as any;
      // The module is exposed in a preRun, while the IndexedDB load is still in
      // flight: the file system is settled once no syncfs request is pending.
      return (
        (w.__zhwpModule !== undefined && w.__zhwpModule.FS.syncFSRequests === 0) ||
        w.__zhwpDone?.status === "error"
      );
    },
    null,
    { timeout: 60_000 },
  );
  const done = await page.evaluate(() => (window as any).__zhwpDone);
  expect(done?.status, `engine did not start: ${done?.message ?? ""}`).not.toBe("error");
  const hasModule = await page.evaluate(() => (window as any).__zhwpModule !== undefined);
  expect(hasModule, "the engine must expose window.__zhwpModule before main").toBe(true);
}

// Writes a file through the module's FS and flushes it to IndexedDB, as an
// earlier page load would have done.
async function writeAndSaveUserFile(page: Page, path: string, data: number[]): Promise<void> {
  await page.evaluate(
    async ({ path, data }) => {
      const { saveUserData } = (await import("/dist/engine.js")) as any;
      const w = window as any;
      const fullPath = `/home/web_user/.local/share/GeneralsX/${path}`;
      w.__zhwpModule.FS.mkdirTree(fullPath.slice(0, fullPath.lastIndexOf("/")));
      w.__zhwpModule.FS.writeFile(fullPath, new Uint8Array(data));
      await saveUserData(w.__zhwpModule);
    },
    { path, data },
  );
}

async function readModuleFile(page: Page, path: string): Promise<number[] | null> {
  return page.evaluate((filePath) => {
    const w = window as any;
    if (!w.__zhwpModule.FS.analyzePath(filePath).exists) return null;
    return Array.from(w.__zhwpModule.FS.readFile(filePath)) as number[];
  }, path);
}

async function modulePathExists(page: Page, path: string): Promise<boolean> {
  return page.evaluate((filePath) => (window as any).__zhwpModule.FS.analyzePath(filePath).exists, path);
}

// Waits for the smoke page to reach the engine's main, then checks that the
// module was exposed and that the page did not fail.
async function waitForSmokeModule(page: Page): Promise<void> {
  await page.waitForFunction(
    (milestone) => {
      const w = window as any;
      return (
        w.__zhwpDone !== undefined ||
        (w.__zhwpLog ?? []).some((line: string) => line.includes(milestone))
      );
    },
    STARTED_MILESTONE,
    { timeout: 60_000 },
  );
  const outcome = await page.evaluate(() => {
    const w = window as any;
    return { done: w.__zhwpDone, hasModule: w.__zhwpModule !== undefined };
  });
  expect(outcome.done?.status, `smoke page reported: ${outcome.done?.message ?? ""}`).not.toBe("error");
  expect(outcome.hasModule, "window.__zhwpModule must be set by a preRun").toBe(true);
}

async function servedReplayBytes(request: APIRequestContext): Promise<number[]> {
  const response = await request.get(REPLAY_URL);
  expect(response.status()).toBe(200);
  return Array.from(await response.body());
}

test("1: addUserFiles throws for empty, absolute, empty-segment and dot-segment paths", async ({ page }) => {
  await page.goto("/harness/index.html");
  const result = await page.evaluate(async (paths) => {
    const { addUserFiles } = (await import("/dist/engine.js")) as any;
    if (typeof addUserFiles !== "function") return { exported: false, results: [] as string[], safe: "" };
    const results = paths.map((path) => {
      try {
        addUserFiles({}, [{ path, data: new Uint8Array([1]) }]);
        return "returned";
      } catch (error) {
        return error instanceof Error ? "Error" : String(error);
      }
    });
    let safe = "threw";
    try {
      addUserFiles({}, [{ path: "Replays/a.rep", data: new Uint8Array([1]) }]);
      safe = "returned";
    } catch (error) {
      safe = `threw: ${String(error)}`;
    }
    return { exported: true, results, safe };
  }, ["", "/a", "a//b", "./a", "a/../b"]);

  expect(result.exported, "addUserFiles must be re-exported by /dist/engine.js").toBe(true);
  expect(result.results).toEqual(["Error", "Error", "Error", "Error", "Error"]);
  expect(result.safe, "a valid relative path must not throw").toBe("returned");
});

test("2: with plain options the given file is readable at its full path with identical bytes", async ({ page }) => {
  const bytes = encode("plain options replay bytes");
  await startHarnessEngine(page, [{ path: "Replays/zhwp-plain.rep", data: bytes }], false);

  const exists = await modulePathExists(page, `${DATA}/Replays/zhwp-plain.rep`);
  expect(exists, "the file must exist under USER_DATA_DIRS[0]").toBe(true);
  expect(await readModuleFile(page, `${DATA}/Replays/zhwp-plain.rep`)).toEqual(bytes);
});

test("3: parent folders of a nested file path are created", async ({ page }) => {
  const bytes = encode("nested replay bytes");
  await startHarnessEngine(page, [{ path: "Replays/nested/deep/zhwp-nested.rep", data: bytes }], false);

  const dirs = await page.evaluate((paths: string[]) => {
    const fs = (window as any).__zhwpModule.FS;
    return paths.map((path) => {
      const analyzed = fs.analyzePath(path);
      return analyzed.exists && fs.isDir(fs.stat(path).mode);
    });
  }, [`${DATA}/Replays`, `${DATA}/Replays/nested`, `${DATA}/Replays/nested/deep`]);
  expect(dirs).toEqual([true, true, true]);
  expect(await readModuleFile(page, `${DATA}/Replays/nested/deep/zhwp-nested.rep`)).toEqual(bytes);
});

test("4: a file saved to IndexedDB in an earlier load stays alongside the given file", async ({ page }) => {
  const saved = encode("saved to IndexedDB in an earlier page load");
  const given = encode("given with addUserFiles in this page load");

  await startHarnessEngine(page, [], true);
  await writeAndSaveUserFile(page, "Replays/zhwp-earlier.rep", saved);

  await startHarnessEngine(page, [{ path: "Replays/zhwp-given.rep", data: given }], true);
  expect(await modulePathExists(page, `${DATA}/Replays/zhwp-earlier.rep`)).toBe(true);
  expect(await readModuleFile(page, `${DATA}/Replays/zhwp-earlier.rep`)).toEqual(saved);
  expect(await readModuleFile(page, `${DATA}/Replays/zhwp-given.rep`)).toEqual(given);
});

test("5: a file loaded from IndexedDB under the same path is replaced by the given content", async ({ page }) => {
  const stale = encode("stale bytes from IndexedDB");
  const replacement = encode("replacement bytes from addUserFiles");

  await startHarnessEngine(page, [], true);
  await writeAndSaveUserFile(page, "Replays/zhwp-same.rep", stale);

  await startHarnessEngine(page, [{ path: "Replays/zhwp-same.rep", data: replacement }], true);
  expect(await readModuleFile(page, `${DATA}/Replays/zhwp-same.rep`)).toEqual(replacement);
});

test("6: a replay URL places GeneralsZH/Replays/<name> with the served bytes without archives=opfs", async ({ page, request }) => {
  const served = await servedReplayBytes(request);
  await page.goto(`/smoke/index.html?replay=${REPLAY_URL}`);
  await waitForSmokeModule(page);

  const path = `${DATA}/GeneralsZH/Replays/${REPLAY_NAME}`;
  expect(await modulePathExists(page, path)).toBe(true);
  expect(await readModuleFile(page, path)).toEqual(served);
  expect(await modulePathExists(page, `${DATA}/Replays/${REPLAY_NAME}`)).toBe(false);
});

test("6: a replay URL places GeneralsZH/Replays/<name> with the served bytes with archives=opfs", async ({ page, request }) => {
  const served = await servedReplayBytes(request);
  await page.goto(`/smoke/index.html?archives=opfs&replay=${REPLAY_URL}`);
  await waitForSmokeModule(page);

  const path = `${DATA}/GeneralsZH/Replays/${REPLAY_NAME}`;
  expect(await modulePathExists(page, path)).toBe(true);
  expect(await readModuleFile(page, path)).toEqual(served);
  expect(await modulePathExists(page, `${DATA}/Replays/${REPLAY_NAME}`)).toBe(false);
});

test("7: a 404 replay URL is an error with the URL and the engine is not started", async ({ page }) => {
  const missing = "/harness/replays/does-not-exist.rep";
  await page.goto(`/smoke/index.html?module=/harness/args/fake-engine.js&replay=${missing}`);
  await page.waitForFunction(() => (window as any).__zhwpDone !== undefined, null, { timeout: 60_000 });

  const result = await page.evaluate(() => {
    const w = window as any;
    return { done: w.__zhwpDone, engine: w.__fakeEngine };
  });
  expect(result.done?.status).toBe("error");
  expect(result.done?.message ?? "").toContain(missing);
  expect(result.engine, "the engine factory must not be called after a failed replay fetch").toBeUndefined();
});

test("8: window.__zhwpModule is set on the smoke page without archives=opfs", async ({ page }) => {
  await page.goto("/smoke/index.html");
  await waitForSmokeModule(page);
  expect(await page.evaluate(() => typeof (window as any).__zhwpModule)).toBe("object");
});
