# 125: Import errors: typed ImportError and one message catalogue

Issue #125. Phase 1. Size s. First of the ZIP loading epic (#125 to #134;
owner request 2026-10-18): the launcher will load the game from one or more
ZIP files instead of a folder. Error handling is a first-class requirement of
the owner, so every failure of the ZIP path has a code, one message and one
hint, defined in one place.

## Goal
A pure module that names every way a ZIP import can fail and turns any thrown
value into text the launcher can show.

## Read first
* `web/AGENTS.md`, `web/src/install.ts` (style of a pure module),
  `web/src/storage.ts`, `web/tests/install.spec.ts` (Node tests of pure code)

## Contract
New file `web/src/import-error.ts`:

```ts
export type ImportErrorCode =
  | "not-a-zip" | "truncated" | "multi-disk" | "encrypted"
  | "unsupported-method" | "bad-crc" | "unsafe-path"
  | "missing-archives" | "quota-exceeded" | "storage-unavailable"
  | "read-failed" | "aborted" | "unknown";

export interface ImportErrorDetail {
  file?: string;        // zip file name or entry path involved
  missing?: string[];   // for missing-archives, the REQUIRED names not found
  needed?: number;      // bytes, for quota-exceeded when known
  free?: number;        // bytes, for quota-exceeded when known
}

export class ImportError extends Error {
  readonly code: ImportErrorCode;
  readonly detail: ImportErrorDetail;
  constructor(code: ImportErrorCode, detail?: ImportErrorDetail, cause?: unknown);
}

export interface ImportErrorText { code: ImportErrorCode; message: string; hint: string }
export function describeImportError(error: unknown): ImportErrorText;
export function isRecoverable(code: ImportErrorCode): boolean;
```

* `describeImportError` accepts anything. An `ImportError` keeps its code.
  A `DOMException` named `QuotaExceededError` becomes `quota-exceeded`; one
  named `AbortError` becomes `aborted`; `NotAllowedError`, `SecurityError`
  or `InvalidStateError` from storage becomes `storage-unavailable`; a
  `TypeError` or anything else becomes `unknown`.
* `message` is one English sentence naming the problem and, when `detail.file`
  is set, quoting that name. `hint` is one English sentence saying what the
  player can do. Neither is empty, neither contains a stack, the word
  "undefined" or "[object". Messages never contain the trademarks "Command &
  Conquer", "Generals" or "Zero Hour" except inside a quoted file name.
* `missing-archives` lists `detail.missing` joined with `, ` in the message.
  `quota-exceeded` includes sizes in the message when `needed` and `free` are
  given, formatted with `formatBytes` from `web/src/storage.ts`.
* `isRecoverable` is true for `quota-exceeded`, `storage-unavailable`,
  `read-failed`, `aborted` and `unknown` (retrying or freeing space can help)
  and false for the other codes (the ZIP itself is the problem).
* `web/src/test-api.ts` re-exports `ImportError`, `describeImportError`,
  `isRecoverable`.

## Acceptance criteria
1. `new ImportError(code, detail, cause)` is an `Error` with `name` `"ImportError"`, the given `code`, `detail` (default `{}`) and `cause`.
2. `describeImportError` of an `ImportError` returns that code with a non-empty message and hint, for every code in the union.
3. A `DOMException` `QuotaExceededError` maps to `quota-exceeded`, an `AbortError` to `aborted`, and `NotAllowedError`, `SecurityError` and `InvalidStateError` to `storage-unavailable`.
4. A plain `Error`, a `TypeError`, a string and `undefined` map to `unknown` without throwing.
5. The message of `missing-archives` contains every name in `detail.missing`, joined by `, `.
6. The message of `quota-exceeded` with `needed` and `free` contains both sizes formatted by `formatBytes`.
7. When `detail.file` is set, the message of any code contains it in quotes.
8. No message or hint contains `undefined`, `[object`, or a trademark outside a quoted file name.
9. `isRecoverable` is true exactly for `quota-exceeded`, `storage-unavailable`, `read-failed`, `aborted` and `unknown`.

## Test paths
`web/tests/import-error.spec.ts`

## Allowed paths
`web/src/import-error.ts`, `web/src/test-api.ts`

## Check
`cd web && npm ci && npx playwright test tests/import-error.spec.ts`
