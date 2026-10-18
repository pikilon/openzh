// Packs an installed game folder into the ZIP files the launcher loads
// (docs/briefs/131-make-game-zip.md).
//
// Usage (from web/):
//   node scripts/make-game-zip.mjs --src <dir> --out <dir> [--split] [--zip64]
//                                   [--no-videos] [--recode-audio] [--tga-rle]
//                                   [--music-kbps <n>] [--voices-mp3 <n>]
//
// --src defaults to $ZHWP_GAME_DIR. --out must be outside the repository: the
// game files are the player's and never become part of this project. Entries
// are stored (method 0), written by hand, and streamed from disk in chunks so
// memory stays flat; ZIP64 records appear when a size, an offset or the file
// count needs them, or when --zip64 forces them for tests.
//
// --no-videos leaves out .bik files. --recode-audio rebuilds speech*/audio*
// .big archives with the IMA ADPCM encoder while packing, keeping the original
// relative paths and never touching the source folder. --tga-rle applies the
// lossless TGA RLE encoder to the .tga entries of every .big, and
// --music-kbps re-encodes the .mp3 entries at a lower bit rate. --voices-mp3
// turns the .wav entries of speech*/audio* .big archives into raw MP3 under the
// same .wav name; with --recode-audio it wins when the MP3 shrinks and falls
// back to the IMA ADPCM recode otherwise. An archive touched by several flags
// is rebuilt once.
import { mkdir, open, readdir, rename, rm, stat, unlink } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { readBigDirectory, rewriteBig } from "./lib/big-archive.mjs";
import { encodeImaWav } from "./lib/ima-adpcm.mjs";
import { encodeTgaRle } from "./lib/tga-rle.mjs";
import { ffmpegAvailable, reencodeMp3 } from "./lib/mp3-reencode.mjs";
import { encodeWavAsMp3 } from "./lib/wav-mp3.mjs";

const LOCAL_SIGNATURE = 0x04034b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const EOCD_SIGNATURE = 0x06054b50;
const ZIP64_LOCATOR_SIGNATURE = 0x07064b50;
const ZIP64_EOCD_SIGNATURE = 0x06064b50;
const ZIP64_EXTRA_ID = 0x0001;

const MAX_U16 = 0xffff;
const MAX_U32 = 0xffffffff;
const CHUNK_SIZE = 1024 * 1024;
const UTF8_FLAG = 0x0800;
const DOS_DATE_1980 = 0x21;

const REQUIRED = new Map([
  ["zero-hour.zip", ["INIZH.big", "W3DZH.big"]],
  ["generals.zip", ["INI.big", "W3D.big"]],
]);

const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c >>> 0;
}

function crcUpdate(crc, data) {
  let value = crc;
  for (let i = 0; i < data.length; i++) {
    value = CRC_TABLE[(value ^ data[i]) & 0xff] ^ (value >>> 8);
  }
  return value >>> 0;
}

function writeU64(buffer, at, value) {
  buffer.writeUInt32LE(value % 0x1_0000_0000, at);
  buffer.writeUInt32LE(Math.floor(value / 0x1_0000_0000), at + 4);
}

function zip64Extra(values) {
  const body = Buffer.alloc(values.length * 8);
  values.forEach((value, index) => writeU64(body, index * 8, value));
  const extra = Buffer.alloc(4 + body.length);
  extra.writeUInt16LE(ZIP64_EXTRA_ID, 0);
  extra.writeUInt16LE(body.length, 2);
  body.copy(extra, 4);
  return extra;
}

function localHeader(name, crc, size) {
  const zip64 = size >= MAX_U32;
  const extra = zip64 ? zip64Extra([size, size]) : Buffer.alloc(0);
  const header = Buffer.alloc(30);
  header.writeUInt32LE(LOCAL_SIGNATURE, 0);
  header.writeUInt16LE(zip64 ? 45 : 20, 4);
  header.writeUInt16LE(UTF8_FLAG, 6);
  header.writeUInt16LE(0, 8); // stored
  header.writeUInt16LE(0, 10); // modification time
  header.writeUInt16LE(DOS_DATE_1980, 12);
  header.writeUInt32LE(crc, 14);
  header.writeUInt32LE(zip64 ? MAX_U32 : size, 18);
  header.writeUInt32LE(zip64 ? MAX_U32 : size, 22);
  header.writeUInt16LE(name.length, 26);
  header.writeUInt16LE(extra.length, 28);
  return Buffer.concat([header, name, extra]);
}

function centralHeader(name, crc, size, localOffset) {
  const sizeZip64 = size >= MAX_U32;
  const offsetZip64 = localOffset >= MAX_U32;
  const values = [];
  if (sizeZip64) values.push(size, size);
  if (offsetZip64) values.push(localOffset);
  const extra = values.length > 0 ? zip64Extra(values) : Buffer.alloc(0);
  const version = values.length > 0 ? 45 : 20;

  const header = Buffer.alloc(46);
  header.writeUInt32LE(CENTRAL_SIGNATURE, 0);
  header.writeUInt16LE(version, 4); // made by: DOS, version
  header.writeUInt16LE(version, 6); // needed to extract
  header.writeUInt16LE(UTF8_FLAG, 8);
  header.writeUInt16LE(0, 10); // stored
  header.writeUInt16LE(0, 12); // modification time
  header.writeUInt16LE(DOS_DATE_1980, 14);
  header.writeUInt32LE(crc, 16);
  header.writeUInt32LE(sizeZip64 ? MAX_U32 : size, 20);
  header.writeUInt32LE(sizeZip64 ? MAX_U32 : size, 24);
  header.writeUInt16LE(name.length, 28);
  header.writeUInt16LE(extra.length, 30);
  header.writeUInt16LE(0, 32); // comment length
  header.writeUInt16LE(0, 34); // disk number start
  header.writeUInt16LE(0, 36); // internal attributes
  header.writeUInt32LE(0, 38); // external attributes
  header.writeUInt32LE(offsetZip64 ? MAX_U32 : localOffset, 42);
  return Buffer.concat([header, name, extra]);
}

function endRecords(count, centralSize, centralOffset, forceZip64) {
  const zip64 =
    forceZip64 ||
    count >= MAX_U16 ||
    centralSize >= MAX_U32 ||
    centralOffset >= MAX_U32;

  if (!zip64) {
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(EOCD_SIGNATURE, 0);
    eocd.writeUInt16LE(0, 4);
    eocd.writeUInt16LE(0, 6);
    eocd.writeUInt16LE(count, 8);
    eocd.writeUInt16LE(count, 10);
    eocd.writeUInt32LE(centralSize, 12);
    eocd.writeUInt32LE(centralOffset, 16);
    eocd.writeUInt16LE(0, 20);
    return eocd;
  }

  const recordAt = centralOffset + centralSize;
  const record = Buffer.alloc(56);
  record.writeUInt32LE(ZIP64_EOCD_SIGNATURE, 0);
  writeU64(record, 4, 44); // bytes after this field
  record.writeUInt16LE(45, 12);
  record.writeUInt16LE(45, 14);
  record.writeUInt32LE(0, 16); // this disk
  record.writeUInt32LE(0, 20); // central directory disk
  writeU64(record, 24, count);
  writeU64(record, 32, count);
  writeU64(record, 40, centralSize);
  writeU64(record, 48, centralOffset);

  const locator = Buffer.alloc(20);
  locator.writeUInt32LE(ZIP64_LOCATOR_SIGNATURE, 0);
  locator.writeUInt32LE(0, 4);
  writeU64(locator, 8, recordAt);
  locator.writeUInt32LE(1, 16);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(EOCD_SIGNATURE, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(MAX_U16, 8);
  eocd.writeUInt16LE(MAX_U16, 10);
  eocd.writeUInt32LE(MAX_U32, 12);
  eocd.writeUInt32LE(MAX_U32, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([record, locator, eocd]);
}

class Writer {
  constructor(handle) {
    this.handle = handle;
    this.position = 0;
  }

  async write(buffer) {
    let at = 0;
    while (at < buffer.length) {
      const { bytesWritten } = await this.handle.write(
        buffer,
        at,
        buffer.length - at,
        this.position,
      );
      if (bytesWritten === 0) throw new Error("write returned 0 bytes");
      at += bytesWritten;
      this.position += bytesWritten;
    }
  }
}

// Reads the file through one reusable chunk buffer, so a large file never
// leaves a trail of stream chunks waiting for the garbage collector.
async function hashFile(file) {
  const handle = await open(file.absolute, "r");
  const buffer = Buffer.allocUnsafe(CHUNK_SIZE);
  let crc = 0xffffffff;
  let size = 0;
  try {
    for (;;) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, size);
      if (bytesRead === 0) break;
      crc = crcUpdate(crc, buffer.subarray(0, bytesRead));
      size += bytesRead;
    }
  } finally {
    await handle.close();
  }
  return { crc: (crc ^ 0xffffffff) >>> 0, size };
}

async function packFile(writer, file) {
  const { crc, size } = await hashFile(file);
  const name = Buffer.from(file.path, "utf8");
  const offset = writer.position;
  await writer.write(localHeader(name, crc, size));

  const handle = await open(file.absolute, "r");
  const buffer = Buffer.allocUnsafe(CHUNK_SIZE);
  let written = 0;
  try {
    for (;;) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, written);
      if (bytesRead === 0) break;
      await writer.write(buffer.subarray(0, bytesRead));
      written += bytesRead;
    }
  } finally {
    await handle.close();
  }
  if (written !== size) throw new Error(`${file.path} changed while it was packed`);
  return { record: centralHeader(name, crc, size, offset), size };
}

async function writeArchive(finalPath, files, forceZip64) {
  const partialPath = `${finalPath}.partial`;
  const handle = await open(partialPath, "w");
  const writer = new Writer(handle);
  let closed = false;
  try {
    const records = [];
    let bytes = 0;
    for (const file of files) {
      const { record, size } = await packFile(writer, file);
      records.push(record);
      bytes += size;
    }
    const centralOffset = writer.position;
    let centralSize = 0;
    for (const record of records) {
      await writer.write(record);
      centralSize += record.length;
    }
    await writer.write(
      endRecords(records.length, centralSize, centralOffset, forceZip64),
    );
    await handle.close();
    closed = true;
    await rename(partialPath, finalPath);
    return { count: files.length, bytes };
  } catch (error) {
    if (!closed) {
      try {
        await handle.close();
      } catch {
        // Already closed or never opened; the partial file is dropped below.
      }
    }
    try {
      await unlink(partialPath);
    } catch {
      // Nothing to remove.
    }
    throw error;
  }
}

async function collectFiles(root) {
  const files = [];
  const warnings = [];
  const walk = async (dir, segments) => {
    const entries = await readdir(dir, { withFileTypes: true });
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      const absolute = join(dir, entry.name);
      const path = [...segments, entry.name].join("/");
      if (entry.isSymbolicLink()) {
        warnings.push(`skipping symlink: ${path}`);
      } else if (entry.isDirectory()) {
        await walk(absolute, [...segments, entry.name]);
      } else if (entry.isFile()) {
        files.push({ absolute, path });
      } else {
        warnings.push(`skipping special file: ${path}`);
      }
    }
  };
  await walk(root, []);
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { files, warnings };
}

// A .big is an audio archive when its lower-cased file name (not its folder)
// starts with speech or audio.
function isAudioArchive(path) {
  const name = path.split("/").pop().toLowerCase();
  return name.endsWith(".big") && (name.startsWith("speech") || name.startsWith("audio"));
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

// The key that links an entry parsed here with the copy rewriteBig parses:
// names can repeat inside an archive, offsets and sizes do not.
function entryKey(entry) {
  return `${entry.offset}:${entry.size}:${entry.name}`;
}

async function readEntryData(handle, entry) {
  const data = Buffer.alloc(entry.size);
  let done = 0;
  while (done < entry.size) {
    const { bytesRead } = await handle.read(data, done, entry.size - done, entry.offset + done);
    if (bytesRead === 0) throw new Error("unexpected end of file");
    done += bytesRead;
  }
  return data;
}

// Encodes every .wav entry with at most `limit` simultaneous ffmpeg
// processes. The archive handle is shared: positioned reads are safe
// concurrently, and only the workers' current inputs stay in memory.
async function encodeWavEntries(handle, entries, kbps, limit) {
  const replacements = new Map();
  let next = 0;
  const worker = async () => {
    for (;;) {
      const index = next++;
      if (index >= entries.length) return;
      const entry = entries[index];
      const data = await readEntryData(handle, entry);
      const encoded = await encodeWavAsMp3(data, kbps);
      if (encoded !== null) replacements.set(entryKey(entry), encoded);
    }
  };
  const workers = [];
  for (let i = 0; i < Math.min(limit, entries.length); i++) workers.push(worker());
  await Promise.all(workers);
  return replacements;
}

function emptyChanges() {
  return {
    wav: 0,
    tga: 0,
    mp3: 0,
    voices: 0,
    savedWav: 0,
    savedTga: 0,
    savedMp3: 0,
    savedVoices: 0,
  };
}

// Applies every requested .big transform under tmpDir. An archive that several
// flags touch is rebuilt once, with each of its own entries transformed by the
// flag that applies to it; archives without matching entries stay untouched.
// Returns the original path -> temporary file map plus the summary counters.
async function recodeArchives(files, tmpDir, options) {
  const { audio, tgaRle, musicKbps, voicesKbps } = options;
  const voices = Number.isInteger(voicesKbps) && voicesKbps > 0;
  const recoded = new Map();
  const summary = {
    wav: 0,
    wavArchives: 0,
    audioSaved: 0,
    tga: 0,
    tgaArchives: 0,
    rleSaved: 0,
    mp3: 0,
    mp3Archives: 0,
    musicSaved: 0,
    voices: 0,
    voicesArchives: 0,
    voicesSaved: 0,
  };
  let index = 0;

  for (const file of files) {
    if (!file.path.toLowerCase().endsWith(".big")) continue;

    let directory;
    try {
      directory = await readBigDirectory(file.absolute);
    } catch (error) {
      throw new Error(`${file.path}: ${errorMessage(error)}`);
    }

    const names = directory.entries.map((entry) => entry.name.toLowerCase());
    const wantsWav =
      (audio || voices) &&
      isAudioArchive(file.path) &&
      names.some((name) => name.endsWith(".wav"));
    const wantsTga = tgaRle !== false && names.some((name) => name.endsWith(".tga"));
    const wantsMp3 = musicKbps !== null && names.some((name) => name.endsWith(".mp3"));
    if (!wantsWav && !wantsTga && !wantsMp3) continue;

    // The MP3 encoders are asynchronous and rewriteBig transforms entries
    // synchronously, so the .mp3 and .wav entries are re-encoded here before
    // the rebuild and the results are looked up during it.
    const replacements = new Map();
    if (wantsMp3) {
      let handle;
      try {
        handle = await open(file.absolute, "r");
        for (const entry of directory.entries) {
          if (!entry.name.toLowerCase().endsWith(".mp3")) continue;
          const data = await readEntryData(handle, entry);
          const encoded = await reencodeMp3(data, musicKbps);
          if (encoded !== null) replacements.set(entryKey(entry), encoded);
        }
      } catch (error) {
        throw new Error(`${file.path}: ${errorMessage(error)}`);
      } finally {
        if (handle) await handle.close();
      }
    }
    if (wantsWav && voices) {
      let handle;
      try {
        handle = await open(file.absolute, "r");
        const wavEntries = directory.entries.filter((entry) =>
          entry.name.toLowerCase().endsWith(".wav"),
        );
        const encoded = await encodeWavEntries(handle, wavEntries, voicesKbps, 4);
        for (const [key, value] of encoded) replacements.set(key, value);
      } catch (error) {
        throw new Error(`${file.path}: ${errorMessage(error)}`);
      } finally {
        if (handle) await handle.close();
      }
    }

    const changes = emptyChanges();
    await mkdir(tmpDir, { recursive: true });
    const tempPath = join(tmpDir, `${index++}-${file.path.split("/").pop()}`);
    try {
      await rewriteBig(file.absolute, tempPath, {
        select: (entry) => {
          const name = entry.name.toLowerCase();
          if (name.endsWith(".mp3")) return wantsMp3 && replacements.has(entryKey(entry));
          if (name.endsWith(".tga")) return wantsTga;
          if (name.endsWith(".wav")) return wantsWav;
          return false;
        },
        transform: (entry, data) => {
          const name = entry.name.toLowerCase();
          if (name.endsWith(".mp3")) {
            const replacement = replacements.get(entryKey(entry));
            if (replacement === undefined) return null;
            changes.mp3 += 1;
            changes.savedMp3 += data.length - replacement.length;
            return replacement;
          }
          if (name.endsWith(".tga")) {
            const encoded = encodeTgaRle(data);
            if (encoded === null) return null;
            changes.tga += 1;
            changes.savedTga += data.length - encoded.length;
            return encoded;
          }
          if (name.endsWith(".wav")) {
            // With both flags the MP3 wins when it shrinks, always encoded from
            // the original WAV; otherwise fall back to the IMA ADPCM recode.
            const replacement = replacements.get(entryKey(entry));
            if (replacement !== undefined) {
              changes.voices += 1;
              changes.savedVoices += data.length - replacement.length;
              return replacement;
            }
            if (!audio) return null;
            const encoded = encodeImaWav(data);
            if (encoded === null || encoded.length >= data.length) return null;
            changes.wav += 1;
            changes.savedWav += data.length - encoded.length;
            return encoded;
          }
          return null;
        },
      });
    } catch (error) {
      await rm(tempPath, { force: true });
      throw new Error(`${file.path}: ${errorMessage(error)}`);
    }

    if (changes.wav + changes.tga + changes.mp3 + changes.voices === 0) {
      // Nothing shrank: keep the archive's original bytes.
      await rm(tempPath, { force: true });
      continue;
    }

    recoded.set(file.path, tempPath);
    if (changes.wav > 0) {
      summary.wav += changes.wav;
      summary.wavArchives += 1;
      summary.audioSaved += changes.savedWav;
    }
    if (changes.tga > 0) {
      summary.tga += changes.tga;
      summary.tgaArchives += 1;
      summary.rleSaved += changes.savedTga;
    }
    if (changes.mp3 > 0) {
      summary.mp3 += changes.mp3;
      summary.mp3Archives += 1;
      summary.musicSaved += changes.savedMp3;
    }
    if (changes.voices > 0) {
      summary.voices += changes.voices;
      summary.voicesArchives += 1;
      summary.voicesSaved += changes.savedVoices;
    }
  }

  return { recoded, summary };
}

function usage(message) {
  console.error(message);
  console.error(
    "usage: node scripts/make-game-zip.mjs --src <dir> --out <dir> [--split] [--zip64] " +
      "[--no-videos] [--recode-audio] [--tga-rle] [--music-kbps <n>] [--voices-mp3 <n>]",
  );
  return 2;
}

function isInsideRepository(repository, target) {
  const path = relative(repository, target);
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
}

async function main() {
  const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

  let values;
  try {
    ({ values } = parseArgs({
      args: process.argv.slice(2),
      options: {
        src: { type: "string" },
        out: { type: "string" },
        split: { type: "boolean" },
        zip64: { type: "boolean" },
        "no-videos": { type: "boolean" },
        "recode-audio": { type: "boolean" },
        "tga-rle": { type: "boolean" },
        "music-kbps": { type: "string" },
        "voices-mp3": { type: "string" },
      },
      strict: true,
      allowPositionals: false,
    }));
  } catch (error) {
    return usage(error instanceof Error ? error.message : String(error));
  }

  let musicKbps = null;
  if (values["music-kbps"] !== undefined) {
    const value = values["music-kbps"];
    if (!/^[0-9]+$/.test(value)) {
      return usage(`--music-kbps must be a positive integer: ${value}`);
    }
    musicKbps = Number(value);
    if (!Number.isSafeInteger(musicKbps) || musicKbps <= 0) {
      return usage(`--music-kbps must be a positive integer: ${value}`);
    }
  }

  let voicesKbps = null;
  if (values["voices-mp3"] !== undefined) {
    const value = values["voices-mp3"];
    if (!/^[0-9]+$/.test(value)) {
      return usage(`--voices-mp3 must be a positive integer: ${value}`);
    }
    voicesKbps = Number(value);
    if (!Number.isSafeInteger(voicesKbps) || voicesKbps <= 0) {
      return usage(`--voices-mp3 must be a positive integer: ${value}`);
    }
  }

  const src = values.src || process.env.ZHWP_GAME_DIR;
  if (!src) {
    return usage("--src <dir> or $ZHWP_GAME_DIR is required");
  }
  if (!values.out) {
    return usage("--out <dir> is required");
  }

  const source = resolve(src);
  let sourceStat;
  try {
    sourceStat = await stat(source);
  } catch {
    return usage(`--src directory does not exist: ${src}`);
  }
  if (!sourceStat.isDirectory()) {
    return usage(`--src is not a directory: ${src}`);
  }

  const out = resolve(values.out);
  if (isInsideRepository(repository, out)) {
    console.error("refusing to write game data inside the repository");
    return 2;
  }

  // Refuse before creating or touching anything when the encoders' tools are
  // missing: the flags would otherwise silently keep the original bytes.
  if ((musicKbps !== null || voicesKbps !== null) && !(await ffmpegAvailable())) {
    if (voicesKbps !== null) {
      console.error("--voices-mp3 requires ffmpeg and ffprobe on PATH");
    } else {
      console.error("--music-kbps requires ffmpeg and ffprobe on PATH");
    }
    return 2;
  }

  try {
    await mkdir(out, { recursive: true });
    const outStat = await stat(out);
    if (!outStat.isDirectory()) return usage(`--out is not a directory: ${values.out}`);
  } catch {
    return usage(`--out is not a usable directory: ${values.out}`);
  }


  const { files, warnings } = await collectFiles(source);
  for (const warning of warnings) console.warn(warning);

  let packed = files;
  let skippedVideos = null;
  if (values["no-videos"] === true) {
    packed = [];
    let count = 0;
    let bytes = 0;
    for (const file of files) {
      if (file.path.toLowerCase().endsWith(".bik")) {
        count += 1;
        bytes += (await stat(file.absolute)).size;
      } else {
        packed.push(file);
      }
    }
    skippedVideos = { count, bytes };
  }

  const tmpDir = join(out, ".recode-tmp");
  let recoded = new Map();
  let recodeSummary = null;

  try {
    const recodeAudio = values["recode-audio"] === true;
    const recodeTga = values["tga-rle"] === true;
    if (recodeAudio || recodeTga || musicKbps !== null || voicesKbps !== null) {
      try {
        const result = await recodeArchives(packed, tmpDir, {
          audio: recodeAudio,
          tgaRle: recodeTga,
          musicKbps,
          voicesKbps,
        });
        recoded = result.recoded;
        recodeSummary = result.summary;
      } catch (error) {
        console.error(errorMessage(error));
        return 4;
      }
    }

    const packedFiles = packed.map((file) => {
      const tempPath = recoded.get(file.path);
      return tempPath === undefined ? file : { ...file, absolute: tempPath };
    });

    const targets = [];
    if (values.split) {
      const groups = new Map([
        ["zero-hour.zip", []],
        ["generals.zip", []],
      ]);
      for (const file of packedFiles) {
        const segments = file.path.split("/").slice(0, -1);
        const zeroHour = segments.some((segment) =>
          segment.toLowerCase().includes("zero hour"),
        );
        groups.get(zeroHour ? "zero-hour.zip" : "generals.zip").push(file);
      }

      const missing = [];
      for (const [name, group] of groups) {
        if (group.length === 0) continue; // The folder does not hold that install.
        const basenames = new Set(
          group.map((file) => file.path.split("/").pop().toLowerCase()),
        );
        for (const required of REQUIRED.get(name)) {
          if (!basenames.has(required.toLowerCase())) {
            missing.push(`${name}: missing ${required}`);
          }
        }
      }
      if (missing.length > 0) {
        for (const line of missing) console.error(line);
        return 3;
      }

      for (const [name, group] of groups) {
        if (group.length > 0) targets.push({ finalPath: join(out, name), files: group });
      }
    } else {
      targets.push({ finalPath: join(out, "game.zip"), files: packedFiles });
    }

    for (const target of targets) {
      const result = await writeArchive(target.finalPath, target.files, values.zip64 === true);
      console.log(`${target.finalPath} ${result.count} files ${result.bytes} bytes`);
    }
    if (skippedVideos !== null) {
      console.log(
        `skipped videos: ${skippedVideos.count} files, ${skippedVideos.bytes} bytes`,
      );
    }
    if (recodeSummary !== null) {
      if (recodeTga) {
        console.log(
          `rle textures: ${recodeSummary.tga} tga in ${recodeSummary.tgaArchives} archives, ` +
            `saved ${recodeSummary.rleSaved} bytes`,
        );
      }
      if (musicKbps !== null) {
        console.log(
          `music: ${recodeSummary.mp3} mp3 re-encoded at ${musicKbps} kbps in ` +
            `${recodeSummary.mp3Archives} archives, saved ${recodeSummary.musicSaved} bytes`,
        );
      }
      if (voicesKbps !== null) {
        console.log(
          `voices mp3: ${recodeSummary.voices} wav in ${recodeSummary.voicesArchives} archives ` +
            `at ${voicesKbps} kbps, saved ${recodeSummary.voicesSaved} bytes`,
        );
      }
      if (recodeAudio) {
        console.log(
          `recoded audio: ${recodeSummary.wav} wav in ${recodeSummary.wavArchives} archives, ` +
            `saved ${recodeSummary.audioSaved} bytes`,
        );
      }
    }
    return 0;
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  },
);
