# Changelog

All notable changes to this project are documented in this file.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Security

- The HTML report escapes every HAR-supplied string it inserts as HTML
  (request URLs, critical-chain reasons, third-party hostnames). Before, a
  HAR whose URL contained markup executed script when the report was opened.

### Fixed

- The installed `waterfall-lens` command (`npm link`, global install,
  `node_modules/.bin`) did nothing and exited 0, because the entry-point
  check compared the symlinked `argv[1]` with the real module path. Both are
  now resolved through `realpath` first.
- An unparseable `startedDateTime` is rejected instead of producing `NaN`
  timings; a missing `response.content` is a validation error instead of a
  crash; a page without `pageTimings` and a non-string `content.mimeType` are
  tolerated; unexpected analysis errors end in a one-line CLI error.
- `report.html` from the README quickstart is gitignored.
- CI workflow token restricted to `contents: read`; non-major dev-dependency
  audit fixes.

### Added

- `test/hostile-input.test.ts` (runs the generated report in jsdom with
  hostile URLs; malformed-file CLI checks; a 20,000-entry capture).
- `SECURITY.md`, `.editorconfig`, `docs/PRODUCTION_READINESS.md`.

## [1.0.0] - 2026-09-02

### Added
- HAR 1.2 parser with structural validation (`parseHar`, `loadHarFile`) that
  produces precise, actionable errors on truncated or malformed captures.
- Analysis engine (`analyzeHar`): resource classification by MIME type and
  extension, render-blocking classification (document / stylesheet / and
  parser-initiated scripts only), third-party attribution by hostname,
  connection-queueing detection, and critical-chain construction by walking
  `_initiator` links back to the navigation request.
- Plain-English explanation generator summarizing what actually delayed
  first paint: the blocking chain, the single longest pole, queued requests,
  and the heaviest third-party origin.
- Self-contained interactive HTML waterfall viewer (`renderHtmlReport`) with
  zero runtime dependencies: a zoomable, horizontally-scrollable waterfall
  with a synced time ruler, hover tooltips, click-to-highlight initiator
  chains (ancestors and descendants), third-party/render-blocking filters,
  a findings panel, and full light/dark theme support.
- CLI (`waterfall-lens analyze` / `waterfall-lens report`) for scripting and
  local use.
- Three realistic sample HAR fixtures (a heavy news article with ad/analytics
  third parties, a lean fast-loading marketing page, and a minimal single
  request) so the demo works instantly with no external captures needed.
- 109 unit and integration tests across the parser, analysis engine, HTML
  renderer, CLI, and fixtures, with coverage thresholds enforced in CI.
