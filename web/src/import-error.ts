// Typed failures of the ZIP import path (docs/briefs/125-import-errors.md):
// one code, one message and one hint per failure, so the launcher can show
// what went wrong and what the player can do. Pure logic: no DOM, runs in Node
// and in the browser.

import { formatBytes } from "./storage";

export type ImportErrorCode =
  | "not-a-zip"
  | "truncated"
  | "multi-disk"
  | "encrypted"
  | "unsupported-method"
  | "bad-crc"
  | "unsafe-path"
  | "missing-archives"
  | "quota-exceeded"
  | "storage-unavailable"
  | "read-failed"
  | "aborted"
  | "unknown";

export interface ImportErrorDetail {
  file?: string; // zip file name or entry path involved
  missing?: string[]; // for missing-archives, the REQUIRED names not found
  needed?: number; // bytes, for quota-exceeded when known
  free?: number; // bytes, for quota-exceeded when known
}

export class ImportError extends Error {
  readonly code: ImportErrorCode;
  readonly detail: ImportErrorDetail;

  constructor(code: ImportErrorCode, detail?: ImportErrorDetail, cause?: unknown) {
    super(code, cause === undefined ? undefined : { cause });
    this.name = "ImportError";
    this.code = code;
    this.detail = detail ?? {};
  }
}

export interface ImportErrorText {
  code: ImportErrorCode;
  message: string;
  hint: string;
}

const RECOVERABLE = new Set<ImportErrorCode>([
  "quota-exceeded",
  "storage-unavailable",
  "read-failed",
  "aborted",
  "unknown",
]);

export function isRecoverable(code: ImportErrorCode): boolean {
  return RECOVERABLE.has(code);
}

function quoted(file: string): string {
  return `"${file}"`;
}

function describe(code: ImportErrorCode, detail: ImportErrorDetail): ImportErrorText {
  const file = detail.file;
  const suffix = file === undefined ? "" : ` (file: ${quoted(file)})`;
  switch (code) {
    case "not-a-zip":
      return {
        code,
        message: `The selected file${suffix} is not a valid ZIP archive.`,
        hint: "Choose the ZIP file downloaded from your game installation.",
      };
    case "truncated":
      return {
        code,
        message: `The ZIP archive${suffix} is truncated and cannot be read to the end.`,
        hint: "Download or copy the ZIP again, then retry the import.",
      };
    case "multi-disk":
      return {
        code,
        message: `The ZIP archive${suffix} is part of a multi-disk set, which is not supported.`,
        hint: "Combine the parts into a single ZIP, or use a complete archive.",
      };
    case "encrypted":
      return {
        code,
        message: `The ZIP archive${suffix} is encrypted; encrypted archives are not supported.`,
        hint: "Create a ZIP without a password, then retry the import.",
      };
    case "unsupported-method":
      return {
        code,
        message: `The ZIP archive${suffix} uses a compression method this app does not support.`,
        hint: "Create the ZIP with standard deflate compression, then retry.",
      };
    case "bad-crc":
      return {
        code,
        message: `A file in the ZIP archive${suffix} failed its checksum test.`,
        hint: "Download or copy the ZIP again; the file is damaged.",
      };
    case "unsafe-path":
      return {
        code,
        message: `The ZIP archive${suffix} contains an entry with an unsafe path.`,
        hint: "Use a ZIP made from a trusted game installation.",
      };
    case "missing-archives": {
      const names = detail.missing ?? [];
      const list = names.length > 0 ? names.join(", ") : "one or more required archives";
      return {
        code,
        message: `The ZIP archive${suffix} is missing required archives: ${list}.`,
        hint: "Add the missing archives to the ZIP, or select a complete one.",
      };
    }
    case "quota-exceeded": {
      const hasSizes =
        typeof detail.needed === "number" && typeof detail.free === "number";
      const sizes = hasSizes
        ? `${formatBytes(detail.needed as number)} needed, ${formatBytes(detail.free as number)} free`
        : "not enough free space";
      return {
        code,
        message: `There is not enough storage space${suffix}: ${sizes}.`,
        hint: "Free up browser storage or choose a smaller ZIP, then retry.",
      };
    }
    case "storage-unavailable":
      return {
        code,
        message: `Browser storage is unavailable${suffix}.`,
        hint: "Allow storage for this site in the browser settings, then retry.",
      };
    case "read-failed":
      return {
        code,
        message: `The ZIP archive${suffix} could not be read.`,
        hint: "Retry the import; if it fails again, copy the ZIP again.",
      };
    case "aborted":
      return {
        code,
        message: `The import${suffix} was cancelled before it finished.`,
        hint: "Start the import again when ready.",
      };
    case "unknown":
    default:
      return {
        code,
        message: `The import${suffix} failed for an unexpected reason.`,
        hint: "Retry the import; if it keeps failing, report the problem.",
      };
  }
}

export function describeImportError(error: unknown): ImportErrorText {
  if (error instanceof ImportError) {
    return describe(error.code, error.detail);
  }
  if (typeof DOMException !== "undefined" && error instanceof DOMException) {
    switch (error.name) {
      case "QuotaExceededError":
        return describe("quota-exceeded", {});
      case "AbortError":
        return describe("aborted", {});
      case "NotAllowedError":
      case "SecurityError":
      case "InvalidStateError":
        return describe("storage-unavailable", {});
    }
  }
  return describe("unknown", {});
}
