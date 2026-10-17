# Model Results

One row per delegated attempt (D-05). The architect appends a row after
verifying each attempt. Used to decide which models do which work well.

| Date | Issue | Step | Model | Result | Time | Note |
| --- | --- | --- | --- | --- | --- | --- |
| 2026-10-17 | trial | code | mimo-v2.6-pro | ok | <1 min | `.big` index parser |
| 2026-10-17 | #3 | code | mimo-v2.6-pro | ok | 28 min | 3 API-drift compile fixes |
| 2026-10-17 | #4 | code | mimo-v2.6-pro | failed | 3 min | provider aborted; retried |
| 2026-10-17 | #4 | code | mimo-v2.6-pro | ok | 14 min | dev server + smoke page |
| 2026-10-17 | #5a | code | mimo-v2.6-pro | ok | 4 min | OPFS store + bridge |
| 2026-10-17 | #5b | code | mimo-v2.6-pro | failed | 30 min | time-out; root readdir empty, debug code left; lead fixed |
| 2026-10-17 | #5c | code | mimo-v2.6-pro | ok | 16 min | launcher page |
| 2026-10-17 | #13 | code | mimo-v2.6-pro | ok | 10 min | bridge watchdog |
| 2026-10-17 | #18 | code | local ornith-1.5-35b | ok | 2 min | one CSS rule |
| 2026-10-17 | #19 | code | mimo-v2.6-pro | ok | 6 min | IDBFS persistence; provider content_filter at the end; lead fixed double populate |

Before D-05 the lead agent wrote all tests, so there are no test-writing rows yet.
