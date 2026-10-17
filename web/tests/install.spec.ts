import { test, expect } from "@playwright/test";
import { classifyArchives, REQUIRED } from "../src/install";

// Pure logic: runs in Node, no browser needed.

test("classifies Zero Hour and Generals archives from picker paths", () => {
  const report = classifyArchives([
    "Zero Hour/INIZH.big",
    "Zero Hour/W3DZH.BIG",
    "Zero Hour/readme.txt",
    "Generals/INI.big",
    "Generals/W3D.big",
    "Generals/English.big",
  ]);
  expect(report.archives).toEqual([
    { kind: "zh", name: "INIZH.big", path: "Zero Hour/INIZH.big" },
    { kind: "zh", name: "W3DZH.BIG", path: "Zero Hour/W3DZH.BIG" },
    { kind: "generals", name: "English.big", path: "Generals/English.big" },
    { kind: "generals", name: "INI.big", path: "Generals/INI.big" },
    { kind: "generals", name: "W3D.big", path: "Generals/W3D.big" },
  ]);
  expect(report.missing).toEqual([]);
});

test("reports required archives that are missing, Zero Hour first", () => {
  const report = classifyArchives(["x/W3D.big", "x/MapsZH.big"]);
  expect(report.missing).toEqual(["INIZH.big", "W3DZH.big", "INI.big"]);
  expect(REQUIRED.zh).toEqual(["INIZH.big", "W3DZH.big"]);
  expect(REQUIRED.generals).toEqual(["INI.big", "W3D.big"]);
});

test("matching is case-insensitive and the first duplicate wins", () => {
  const report = classifyArchives(["a/inizh.big", "b/INIZH.big", "a/w3dzh.big", "a/ini.BIG", "a/W3D.big"]);
  expect(report.missing).toEqual([]);
  expect(report.archives.filter((a) => a.name.toLowerCase() === "inizh.big")).toEqual([
    { kind: "zh", name: "inizh.big", path: "a/inizh.big" },
  ]);
});

test("ignores everything that is not a .big archive", () => {
  const report = classifyArchives(["a/game.dat", "a/big", "a/INIZH.big.bak", "a/.big"]);
  expect(report.archives).toEqual([]);
});
