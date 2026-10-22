# Production readiness — waterfall-lens

Tested commit: `f740970` (audit/production-readiness; this file was added in
the following docs-only commit). Date: 2026-10-22.

## Scope and architecture

A CLI and library that parse a HAR file, normalise entries, reconstruct the
render-blocking critical chain from `_initiator` links, attribute weight to
third-party hosts, detect connection-queued requests, and either print a
plain-English explanation or write a self-contained interactive HTML report
(embedded JSON + vanilla JS, no network requests).

## Platforms and prerequisites

- Node >= 18 (`engines`); CI runs Node 20 and 22 on Linux/Windows/macOS.
  Verified locally on macOS 27 (Apple M5), Node 24.19.0, npm 11.17.0.
  Windows was not run locally.
- The report opens in any modern browser from `file://`.

## Clean-clone verification

| Step (README, literally) | Exit / result |
|---|---|
| `git clone …`, `npm install` | 0 |
| `npm run dev -- analyze fixtures/news-article-heavy.har` | 0, output matches the README example |
| `npm run dev -- report fixtures/news-article-heavy.har --out report.html` | 0, 12 requests |
| Open `report.html` in headless Chromium, click a row | renders, no page errors |
| `npm run typecheck`, `lint`, `build`, `coverage` | all 0; 117 passed |
| CI smoke: `node dist/cli.js analyze …`, `report … --out …` + the two greps | pass |

## Commands and results (CI steps)

| Check | Command | Before | After |
|---|---|---|---|
| Install | `npm ci` | 0 | 0 |
| Typecheck | `npm run typecheck` | 0 | 0 |
| Lint | `npm run lint` | 0 | 0 |
| Build | `npm run build` | 0 | 0 |
| Tests + coverage | `npm run coverage` | 0 — 109 passed | 0 — 117 passed, 0 failed, 0 skipped; statements 98.75% |
| Hostile HAR in a real browser | report from a HAR with `"><img onerror=…>` in a URL, opened in headless Chromium | script executed (`window.__pwned === 1`), 2 injected `<img>` | not executed, 0 `<img>` |
| Malformed HAR via CLI | unparseable date / no `content` / page without `pageTimings` | `NaN` output / stack trace / stack trace | one-line error exit 1 / one-line error exit 1 / works |
| Large HAR | 20,001 entries: CLI `report`; open report, click a row | — | CLI ~0.2 s; report load ~2.4 s, click redraw ~1.2 s |
| Runtime dependency audit | `npm audit --omit=dev` | 0 (no runtime deps) | 0 |
| Full audit | `npm audit` | dev-only critical/high (vitest 2 chain) | brace-expansion, source-map-js fixed; vitest chain needs vitest 5, not done |

## CI status

Default branch: success (latest `main` run). Audit branch: pending until pushed.

## Bugs found and fixed

1. **Stored XSS in the HTML report** (security). URLs, chain reasons and
   hostnames were concatenated into `innerHTML`. Fixed with an escape helper
   on every interpolated value. Regression: `test/hostile-input.test.ts`
   executes the generated report in jsdom.
2. **Malformed HAR handling**: `NaN` timings from bad dates; crashes on a
   missing `response.content` or `pageTimings`. Fixed in `parser.ts`,
   `analyze.ts`, `types.ts`, `cli.ts`, with tests.
3. **Quickstart output not ignored** (`report.html`). Added to `.gitignore`.

## Security review

- Secret scan of tree and full history: no hits.
- Untrusted input: HTML report escaping (fixed), embedded JSON escapes `<`.
  The report copies full request URLs (including query strings) but no
  headers or bodies — documented in `SECURITY.md`.
- No network access in the CLI or report.
- CI token now `contents: read`; actions pinned to tags (unchanged).

## Known limitations

- Render-blocking classification is a documented heuristic (HAR has no
  `async`/`defer`/media metadata).
- The report's initiator lookups are quadratic in the number of entries;
  20,000 entries is usable (figures above) but much larger captures will be
  slow in the browser.
- The whole HAR is read into memory.
- Remaining dev-only advisories need vitest 5.

## Acceptance checklist

| # | Item | Expected | Command / test | Result | Reference |
|---|---|---|---|---|---|
| 1 | README example output | matches | clean-clone `analyze` | pass | `src/analyze.ts` |
| 2 | Critical chain from initiators | correct chain | `test/analyze.test.ts`, `fixtures.test.ts` | pass | `src/analyze.ts` |
| 3 | Third-party attribution by host | sorted by bytes | `test/analyze.test.ts` | pass | `src/analyze.ts` |
| 4 | Queued vs slow | separate finding | `test/analyze.test.ts` | pass | `src/analyze.ts` |
| 5 | Report is self-contained | no external requests | Chromium render | pass | `src/html.ts` |
| 6 | Untrusted strings escaped | no injected elements/script | `hostile-input.test.ts`, Chromium probe | pass | `src/html.ts` |
| 7 | Malformed HAR → clear error | exit 1, one line | `hostile-input.test.ts` | pass | `src/parser.ts`, `src/cli.ts` |
| 8 | Large HAR | 20k entries analysed < 10 s | `hostile-input.test.ts` | pass | `src/analyze.ts` |

## Classification proposal

**READY FOR DOCUMENTED SCOPE** (proposal; pending audit-branch CI and the
lead's independent verification).
