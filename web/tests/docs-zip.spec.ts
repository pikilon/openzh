import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Contract of docs/briefs/134-zip-docs.md.
//
// These are Node-side tests: they read the written project knowledge from the
// repository root and never launch a page. Requirement 4 (no EA assets) is the
// shell check scripts/check-no-ea-assets.sh and is not covered here.

const TESTS_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(TESTS_DIR, "..", "..");

function read(relativePath: string): string {
  return readFileSync(join(REPO_ROOT, relativePath), "utf8");
}

// Body of the first Markdown section whose heading is exactly `title`, up to
// the next heading of the same or a higher level. Null when it is missing.
function sectionBody(markdown: string, title: string): string | null {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((line) => {
    const heading = /^(#{1,6})\s+(.*?)\s*$/.exec(line);
    return heading !== null && heading[2] === title;
  });
  if (start === -1) {
    return null;
  }
  const level = /^(#{1,6})/.exec(lines[start])![1].length;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    const heading = /^(#{1,6})\s+/.exec(lines[i]);
    if (heading !== null && heading[1].length <= level) {
      end = i;
      break;
    }
  }
  return lines.slice(start + 1, end).join("\n");
}

test("1: docs/decisions.md records D-10 for ZIP-only loading", () => {
  const decisions = read("docs/decisions.md");
  expect(decisions).toContain("## D-10: The game is loaded from ZIP files");
  expect(decisions).toMatch(/ZHWP_GAME_ZIPS/);
  expect(decisions).toMatch(/nothing is uploaded/i);
});

test("2: web/AGENTS.md documents ZIP loading in a Local Game Data section", () => {
  const webAgents = read("web/AGENTS.md");
  const localGameData = sectionBody(webAgents, "Local Game Data");
  expect(localGameData, "web/AGENTS.md has no 'Local Game Data' section").not.toBeNull();
  expect(localGameData).toContain("ZHWP_GAME_ZIPS");
  expect(localGameData).toContain("make-game-zip.mjs");
  expect(webAgents).not.toContain("--gamedata");
  expect(webAgents).not.toContain("folder-input");
  expect(webAgents).not.toContain("webkitdirectory");
});

test("3: README.md tells the player to load ZIP files and that nothing is uploaded", () => {
  const readme = read("README.md");
  expect(readme).toMatch(/zip files/i);
  expect(readme).toMatch(/nothing is uploaded/i);
});
