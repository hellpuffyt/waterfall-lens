# Changelog

All notable changes to this project are documented in this file.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

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
