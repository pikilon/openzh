import { test, expect } from "@playwright/test";
import { formatBytes } from "../src/storage";

// Pure logic: runs in Node, no browser needed.

type ImportErrorModule = typeof import("../src/import-error");
let api: ImportErrorModule;

test.beforeEach(async () => {
  api = await import("../src/import-error");
});

const CODES = [
  "not-a-zip",
  "truncated",
  "multi-disk",
  "encrypted",
  "unsupported-method",
  "bad-crc",
  "unsafe-path",
  "missing-archives",
  "quota-exceeded",
  "storage-unavailable",
  "read-failed",
  "aborted",
  "unknown",
] as const;

const RECOVERABLE = ["quota-exceeded", "storage-unavailable", "read-failed", "aborted", "unknown"];

// Any of the usual quote characters counts as quoting a file name.
const QUOTE = "[\"'`“”‘’]";
const TRADEMARK = /Command\s*&\s*Conquer|Generals|Zero Hour/i;

function quotedPattern(name: string): RegExp {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`${QUOTE}${escaped}${QUOTE}`);
}

function withoutQuotedText(text: string): string {
  return text.replace(/["'`“”‘’][^"'`“”‘’]*["'`“”‘’]/g, " ");
}

function causeOf(error: Error): unknown {
  return (error as Error & { cause?: unknown }).cause;
}

test("1: ImportError is an Error with name, code, detail and cause", () => {
  const cause = new Error("disk gone");
  const detail = { file: "game.zip", needed: 10 };
  const error = new api.ImportError("bad-crc", detail, cause);
  expect(error).toBeInstanceOf(Error);
  expect(error).toBeInstanceOf(api.ImportError);
  expect(error.name).toBe("ImportError");
  expect(error.code).toBe("bad-crc");
  expect(error.detail).toEqual(detail);
  expect(causeOf(error)).toBe(cause);

  const bare = new api.ImportError("unknown");
  expect(bare.detail).toEqual({});
  expect(causeOf(bare)).toBeUndefined();
});

test("2: every code describes a non-empty message and hint", () => {
  expect(CODES).toHaveLength(13);
  for (const code of CODES) {
    const text = api.describeImportError(new api.ImportError(code));
    expect(text.code, code).toBe(code);
    expect(text.message.trim(), code).not.toBe("");
    expect(text.hint.trim(), code).not.toBe("");
  }
});

test("3: DOMException names map to quota-exceeded, aborted and storage-unavailable", () => {
  const expected: Record<string, string> = {
    QuotaExceededError: "quota-exceeded",
    AbortError: "aborted",
    NotAllowedError: "storage-unavailable",
    SecurityError: "storage-unavailable",
    InvalidStateError: "storage-unavailable",
  };
  for (const [name, code] of Object.entries(expected)) {
    const text = api.describeImportError(new DOMException("storage failure", name));
    expect(text.code, name).toBe(code);
    expect(text.message.trim(), name).not.toBe("");
    expect(text.hint.trim(), name).not.toBe("");
  }
});

test("4: anything else maps to unknown without throwing", () => {
  const values: unknown[] = [new Error("boom"), new TypeError("not a function"), "oops", undefined];
  for (const value of values) {
    expect(() => api.describeImportError(value), String(value)).not.toThrow();
    const text = api.describeImportError(value);
    expect(text.code, String(value)).toBe("unknown");
    expect(text.message.trim(), String(value)).not.toBe("");
    expect(text.hint.trim(), String(value)).not.toBe("");
  }
});

test("5: missing-archives message joins every missing name with a comma and a space", () => {
  const missing = ["INIZH.big", "W3DZH.big", "INI.big"];
  const message = api.describeImportError(new api.ImportError("missing-archives", { missing })).message;
  expect(message).toContain(missing.join(", "));
  for (const name of missing) expect(message, name).toContain(name);
});

test("6: quota-exceeded message contains needed and free formatted with formatBytes", () => {
  const needed = 3 * 1024 ** 3;
  const free = 700 * 1024 ** 2;
  const message = api.describeImportError(new api.ImportError("quota-exceeded", { needed, free })).message;
  expect(formatBytes(needed)).not.toBe(formatBytes(free));
  expect(message).toContain(formatBytes(needed));
  expect(message).toContain(formatBytes(free));
});

test("7: every code quotes detail.file in its message", () => {
  const file = "game-data.zip";
  for (const code of CODES) {
    const message = api.describeImportError(new api.ImportError(code, { file })).message;
    expect(message, `${code}: ${message}`).toMatch(quotedPattern(file));
  }
});

test("8: messages and hints avoid undefined, [object, trademarks outside quotes and stacks", () => {
  const cause = new Error("inner failure");
  const stack = cause.stack;
  for (const code of CODES) {
    for (const file of [undefined, "install.zip", "Zero Hour/INIZH.big"]) {
      const detail = file === undefined ? undefined : { file };
      const text = api.describeImportError(new api.ImportError(code, detail, cause));
      for (const value of [text.message, text.hint]) {
        expect(value, `${code}: ${value}`).not.toContain("undefined");
        expect(value, `${code}: ${value}`).not.toContain("[object");
        if (stack !== undefined) expect(value, `${code}: ${value}`).not.toContain(stack);
        expect(withoutQuotedText(value), `${code}: ${value}`).not.toMatch(TRADEMARK);
      }
    }
  }
});

test("9: isRecoverable is true exactly for the codes where retrying or freeing space helps", () => {
  for (const code of CODES) {
    expect(api.isRecoverable(code), code).toBe(RECOVERABLE.includes(code));
  }
});

test("contract: test-api re-exports ImportError, describeImportError and isRecoverable", async () => {
  const entry = await import("../src/test-api");
  expect(entry.ImportError).toBe(api.ImportError);
  expect(entry.describeImportError).toBe(api.describeImportError);
  expect(entry.isRecoverable).toBe(api.isRecoverable);
});
