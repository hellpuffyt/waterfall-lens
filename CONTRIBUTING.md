# Contributing

Thanks for taking a look at waterfall-lens. This is a small, focused
project, so the process is lightweight.

## Setup

```bash
npm install
npm run dev -- analyze fixtures/news-article-heavy.har
```

## Before opening a PR

```bash
npm run typecheck
npm run lint
npm test
npm run coverage   # must stay at or above the thresholds in vitest.config.ts
npm run build
```

All four must pass cleanly (zero lint warnings, zero type errors) before a
change is merged. CI runs the same checks on Linux, macOS, and Windows
across two Node.js versions.

## Project layout

- `src/types.ts` — HAR 1.2 type definitions.
- `src/parser.ts` — parsing and structural validation.
- `src/analyze.ts` — the analysis engine: classification, third-party
  attribution, critical-chain detection, and the explanation generator.
- `src/html.ts` — the self-contained interactive HTML report.
- `src/cli.ts` — the `waterfall-lens` command-line entry point.
- `test/` — unit and integration tests, mirroring the `src/` modules plus a
  `fixtures.test.ts` that exercises the sample HAR files end to end.
- `fixtures/` — sample HAR captures used by the tests and the demo.
- `scripts/gen-fixtures.mjs` — regenerates the sample fixtures; run it
  directly with `node scripts/gen-fixtures.mjs` if you need to add or adjust
  a scenario.

## Adding a new analysis heuristic

If you add a new classification rule (e.g. a new render-blocking case),
please:

1. Add unit tests in `test/analyze.test.ts` covering both the positive and
   negative case.
2. Add a doc comment above the function explaining the reasoning — HAR files
   don't carry everything a browser knows (no `async`/`defer` attributes, no
   media-query info for stylesheets), so heuristics should be documented as
   such rather than presented as exact simulation.
3. If the change is visible in the report, consider whether a fixture in
   `fixtures/` should be extended to exercise it in the demo.

## Reporting a bug

Please include the HAR file (or a minimal reproduction) that triggers the
issue, if you're able to share it — most bugs here are shape-of-real-world-data
bugs.
