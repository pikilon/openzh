import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const LINE_PATTERN = /^ZHWP_CRC (\d+) ([0-9a-fA-F]{8})\r?$/;

export function parseCrcLog(text, name = "log") {
  const entries = [];
  const lines = text.split("\n");

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.startsWith("ZHWP_CRC ")) continue;

    const match = LINE_PATTERN.exec(line);
    if (match === null) {
      throw new Error(`${name}:${index + 1}: malformed CRC line`);
    }

    const frame = Number(match[1]);
    const previous = entries[entries.length - 1];
    if (previous !== undefined && frame <= previous.frame) {
      throw new Error(`${name}:${index + 1}: frames are not strictly increasing`);
    }

    entries.push({ frame, crc: match[2].toLowerCase() });
  }

  return entries;
}

export function compareCrcLogs(a, b) {
  const aByFrame = new Map(a.map((entry) => [entry.frame, entry.crc]));
  const bByFrame = new Map(b.map((entry) => [entry.frame, entry.crc]));
  const frames = [...new Set([...aByFrame.keys(), ...bByFrame.keys()])].sort(
    (left, right) => left - right,
  );

  for (const frame of frames) {
    const aCrc = aByFrame.get(frame) ?? "missing";
    const bCrc = bByFrame.get(frame) ?? "missing";
    if (aCrc !== bCrc) {
      return { match: false, frame, a: aCrc, b: bCrc };
    }
  }

  return { match: true, frames: frames.length };
}

function fail(message) {
  process.stderr.write(`ERROR ${message}\n`);
  process.exitCode = 2;
}

function readLog(path) {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    const detail = String(error?.message ?? error).replace(/\s+/g, " ");
    fail(`${path}: ${detail}`);
    return null;
  }
}

function main(argv) {
  if (argv.length !== 2) {
    fail("expected exactly two log files");
    return;
  }

  const [aPath, bPath] = argv;
  const logs = [];
  for (const path of [aPath, bPath]) {
    const text = readLog(path);
    if (text === null) return;

    let entries;
    try {
      entries = parseCrcLog(text, path);
    } catch (error) {
      fail(String(error?.message ?? error).replace(/\s+/g, " "));
      return;
    }

    if (entries.length === 0) {
      fail(`${path}: no CRC lines found`);
      return;
    }

    logs.push(entries);
  }

  const result = compareCrcLogs(logs[0], logs[1]);
  if (result.match) {
    process.stdout.write(`MATCH ${result.frames} frames\n`);
    return;
  }

  process.stdout.write(
    `DIVERGED frame ${result.frame} a=${result.a} b=${result.b}\n`,
  );
  process.exitCode = 1;
}

const entryPoint = process.argv[1]
  ? pathToFileURL(process.argv[1]).href
  : undefined;

if (entryPoint !== undefined && entryPoint === import.meta.url) {
  main(process.argv.slice(2));
}
