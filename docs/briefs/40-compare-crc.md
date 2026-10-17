# 40: Compare two CRC logs

Issue #40. Phase 2. Size s. `local-model-ok`.

## Goal
The oracle compares the per-frame logic CRCs of two runs of the same replay
(native vs browser, or browser vs browser) and reports the first frame where
they differ.

## Read first
* Phase 2 in `AGENTS.md`
* `docs/briefs/41-crc-log.md` (the log line format)

## Contract
`node scripts/oracle/compare-crc.mjs <a.log> <b.log>`; ES module, Node 22+,
no dependencies.

* Log lines: `ZHWP_CRC <frame> <crc>`: `frame` a non-negative decimal
  integer, `crc` exactly 8 hexadecimal digits (any case), single spaces,
  optional trailing `\r`. Lines not starting with `ZHWP_CRC ` are ignored
  (logs contain other engine output). A line starting with `ZHWP_CRC ` that
  does not match is an error. Frames must strictly increase within a file.
* Exports, for tests and other tools:
  ```js
  export function parseCrcLog(text, name = "log"); // → [{ frame, crc }] with crc lower-case; throws Error naming `name` and the 1-based line number
  export function compareCrcLogs(a, b);            // → { match: true, frames } | { match: false, frame, a, b }
  ```
  `compareCrcLogs` looks at the union of frames of both lists in increasing
  order and returns the first frame whose CRC differs, where a frame present
  in only one list has the value `"missing"` in the other. `frames` is the
  number of entries when they match.
* CLI output and exit codes:
  * match: `MATCH <frames> frames`, exit 0;
  * divergence: `DIVERGED frame <frame> a=<crc|missing> b=<crc|missing>`,
    exit 1;
  * wrong arguments, unreadable file, malformed line, frames not strictly
    increasing, or a file without any CRC line: a one-line message starting
    with `ERROR`, exit 2.
* Running the module as a script only happens when it is the entry point
  (importing it has no side effects).

## Acceptance criteria
1. Two identical logs give `MATCH <n> frames` and exit 0.
2. Lines that do not start with `ZHWP_CRC ` are ignored on both sides.
3. CRCs that differ only in letter case match.
4. The first frame with different CRCs is reported as `DIVERGED frame <f> a=<x> b=<y>` with exit 1, even when later frames differ too.
5. When one log stops early, the first frame it lacks is reported with `missing` on its side.
6. A malformed `ZHWP_CRC` line gives exit 2 and a message with the file name and line number.
7. Frames that do not strictly increase give exit 2.
8. A file with no CRC line, a missing file or a wrong number of arguments gives exit 2.
9. Importing the module prints nothing and does not exit.

## Test paths
* `scripts/oracle/tests/` (`node:test` files)

## Allowed paths
* `scripts/oracle/compare-crc.mjs`

## Check command
`node --test scripts/oracle/tests/`
