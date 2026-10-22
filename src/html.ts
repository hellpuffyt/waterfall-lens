import type { WaterfallReport } from './analyze.js';

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Renders a self-contained interactive HTML waterfall report: no network
 * requests, no build step to view it, no runtime dependency. The report
 * data is embedded as a JSON script tag and a small vanilla-JS layer wires
 * up zoom, hover tooltips, filtering, and initiator-chain highlighting.
 */
export function renderHtmlReport(report: WaterfallReport): string {
  const data = JSON.stringify(report).replace(/</g, '\\u003c');
  const title = `waterfall-lens: ${esc(report.sourceLabel)}`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
  :root {
    color-scheme: light dark;
    --bg: #ffffff;
    --bg-alt: #f4f5f7;
    --bg-raised: #ffffff;
    --fg: #16181d;
    --fg-muted: #5b6270;
    --border: #e2e4e9;
    --accent: #2f6fed;
    --accent-fg: #ffffff;
    --blocking: #e0563d;
    --shadow: 0 1px 2px rgba(20, 22, 30, 0.04), 0 8px 24px rgba(20, 22, 30, 0.06);
    --font: #7c3fd6;
    --image: #2fa06a;
    --script: #2f6fed;
    --style: #d63a8f;
    --doc: #444b58;
    --xhr: #0aa3a3;
    --other: #8a8f99;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #0e1014;
      --bg-alt: #161920;
      --bg-raised: #191d25;
      --fg: #e7e9ee;
      --fg-muted: #9aa1af;
      --border: #262b35;
      --shadow: 0 1px 2px rgba(0, 0, 0, 0.3), 0 8px 24px rgba(0, 0, 0, 0.35);
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: var(--bg);
    color: var(--fg);
    font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, sans-serif;
  }
  header {
    padding: 18px 28px;
    border-bottom: 1px solid var(--border);
    display: flex;
    align-items: baseline;
    gap: 10px;
    flex-wrap: wrap;
  }
  header h1 { margin: 0; font-size: 17px; font-weight: 700; letter-spacing: -.01em; }
  header h1 .dot { color: var(--accent); }
  header p { margin: 0; color: var(--fg-muted); font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .summary {
    display: flex;
    gap: 0;
    border-bottom: 1px solid var(--border);
    background: var(--bg-alt);
    overflow-x: auto;
  }
  .stat {
    padding: 14px 24px;
    border-right: 1px solid var(--border);
    min-width: 120px;
  }
  .stat .value { font-size: 21px; font-weight: 700; letter-spacing: -.01em; }
  .stat .label { font-size: 11px; color: var(--fg-muted); text-transform: uppercase; letter-spacing: .05em; margin-top: 2px; }
  main { padding: 24px 28px 60px; max-width: 1280px; margin: 0 auto; }
  section { margin-bottom: 30px; }
  h2 {
    font-size: 12px; text-transform: uppercase; letter-spacing: .06em; color: var(--fg-muted);
    margin: 0 0 12px; display: flex; align-items: center; gap: 8px;
  }
  .explanation {
    white-space: pre-line;
    background: var(--bg-alt);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 16px 18px;
    font-size: 13.5px;
    box-shadow: var(--shadow);
  }
  .controls {
    display: flex; gap: 16px; align-items: center; margin-bottom: 12px; flex-wrap: wrap;
    font-size: 12.5px; color: var(--fg-muted);
  }
  .controls label { display: flex; align-items: center; gap: 6px; cursor: pointer; }
  .controls .zoom { display: flex; align-items: center; gap: 8px; margin-left: auto; }
  .controls input[type="range"] { width: 130px; accent-color: var(--accent); }
  .legend { display: flex; gap: 12px; flex-wrap: wrap; margin-left: 4px; }
  .legend .sw { display: inline-flex; align-items: center; gap: 5px; }
  .legend .chip { width: 9px; height: 9px; border-radius: 2px; display: inline-block; }
  .waterfall-wrap {
    border: 1px solid var(--border);
    border-radius: 10px;
    overflow: hidden;
    box-shadow: var(--shadow);
  }
  .wf-scroll { overflow: auto; max-height: 600px; }
  .ruler {
    display: grid;
    grid-template-columns: 300px 1fr 84px;
    position: sticky; top: 0; z-index: 2;
    background: var(--bg-raised);
    border-bottom: 1px solid var(--border);
    font-size: 10.5px; color: var(--fg-muted);
  }
  .ruler .track { position: relative; min-width: 480px; height: 22px; }
  .ruler .tick { position: absolute; top: 0; bottom: 0; border-left: 1px solid var(--border); padding-left: 3px; padding-top: 4px; white-space: nowrap; }
  .ruler .label { position: sticky; left: 0; padding: 4px 10px; align-self: center; background: var(--bg-raised); }
  .row {
    display: grid;
    grid-template-columns: 300px 1fr 84px;
    align-items: center;
    border-top: 1px solid var(--border);
    padding: 5px 0;
    font-size: 12px;
    cursor: pointer;
  }
  .row:first-child { border-top: none; }
  .row.dim { opacity: .28; }
  .row.related { background: color-mix(in srgb, var(--accent) 8%, transparent); }
  .row.selected { background: color-mix(in srgb, var(--accent) 16%, transparent); }
  .row .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    padding: 0 10px 0 12px;
  }
  .row .name .host { color: var(--fg-muted); }
  .row .name .type-dot { display: inline-block; width: 7px; height: 7px; border-radius: 2px; margin-right: 6px; vertical-align: middle; }
  .track-cell { min-width: 480px; }
  .track { position: relative; height: 16px; background: var(--bg-alt); border-radius: 3px; margin: 0 8px; }
  .bar {
    position: absolute;
    top: 2px;
    height: 12px;
    border-radius: 2px;
    cursor: pointer;
    transition: filter .1s ease;
  }
  .bar:hover { filter: brightness(1.15); }
  .bar.critical { outline: 2px solid var(--blocking); outline-offset: 1px; }
  .bar.selected { outline: 2px solid var(--fg); outline-offset: 1px; }
  .row .dur { text-align: right; color: var(--fg-muted); font-variant-numeric: tabular-nums; padding-right: 12px; }
  .badge {
    display: inline-block;
    font-size: 9.5px;
    padding: 1px 6px;
    border-radius: 999px;
    margin-left: 6px;
    background: var(--border);
    color: var(--fg-muted);
    vertical-align: middle;
  }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { text-align: left; padding: 8px 12px; border-bottom: 1px solid var(--border); }
  th { color: var(--fg-muted); font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  .table-wrap { border: 1px solid var(--border); border-radius: 10px; overflow: hidden; box-shadow: var(--shadow); }
  .chain-list { list-style: none; margin: 0; padding: 0; }
  .chain-list li {
    padding: 10px 12px;
    border: 1px solid var(--border);
    border-left: 3px solid var(--blocking);
    border-radius: 6px;
    margin-bottom: 8px;
    font-size: 13px;
    background: var(--bg-raised);
  }
  .chain-list .meta { color: var(--fg-muted); font-size: 12px; margin-top: 2px; }
  #tooltip {
    position: fixed;
    pointer-events: none;
    background: var(--fg);
    color: var(--bg);
    padding: 8px 10px;
    border-radius: 6px;
    font-size: 12px;
    max-width: 420px;
    z-index: 10;
    display: none;
    white-space: pre-line;
    box-shadow: var(--shadow);
  }
  .empty { color: var(--fg-muted); font-style: italic; padding: 16px; }
  .hint { font-size: 11.5px; color: var(--fg-muted); margin-top: 8px; }
</style>
</head>
<body>
<header>
  <h1>waterfall<span class="dot">-</span>lens</h1>
  <p id="source-label"></p>
</header>
<div class="summary" id="summary"></div>
<main>
  <section>
    <h2>What delayed first paint</h2>
    <div class="explanation" id="explanation"></div>
  </section>
  <section>
    <h2>Critical chain</h2>
    <ol class="chain-list" id="chain"></ol>
  </section>
  <section>
    <h2>Waterfall</h2>
    <div class="controls">
      <label><input type="checkbox" id="third-party-only"> Third-party only</label>
      <label><input type="checkbox" id="blocking-only"> Render-blocking only</label>
      <div class="legend" id="legend"></div>
      <div class="zoom">
        <span>Zoom</span>
        <input type="range" id="zoom-range" min="1" max="8" step="0.5" value="1">
      </div>
    </div>
    <div class="waterfall-wrap">
      <div class="wf-scroll" id="wf-scroll">
        <div class="ruler" id="ruler"></div>
        <div class="waterfall" id="waterfall"></div>
      </div>
    </div>
    <p class="hint">Click a request to highlight its initiator chain (what caused it, and what it caused).</p>
  </section>
  <section>
    <h2>Third-party weight</h2>
    <div class="table-wrap"><table id="third-party-table"></table></div>
  </section>
</main>
<div id="tooltip"></div>
<script id="report-data" type="application/json">${data}</script>
<script>
(function () {
  var report = JSON.parse(document.getElementById('report-data').textContent);
  var typeColor = { document: 'var(--doc)', stylesheet: 'var(--style)', script: 'var(--script)', font: 'var(--font)', image: 'var(--image)', xhr: 'var(--xhr)', other: 'var(--other)' };
  var typeOrder = ['document', 'stylesheet', 'script', 'font', 'image', 'xhr', 'other'];

  document.getElementById('source-label').textContent =
    report.sourceLabel + (report.pageUrl ? ' — ' + report.pageUrl : '');

  // Everything below that is inserted with innerHTML goes through h(): URLs,
  // hostnames and reasons come straight from the (untrusted) HAR file.
  function h(v) {
    return String(v)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function fmtBytes(n) {
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1024 / 1024).toFixed(2) + ' MB';
  }
  function fmtMs(n) { return Math.round(n) + 'ms'; }

  var summary = document.getElementById('summary');
  [
    ['Requests', report.totalRequests],
    ['Total weight', fmtBytes(report.totalBytes)],
    ['Load time', fmtMs(report.totalLoadTimeMs)],
    ['Est. first paint', fmtMs(report.firstPaintEstimateMs)],
    ['Third-party origins', report.thirdPartyAttribution.length],
  ].forEach(function (pair) {
    var d = document.createElement('div');
    d.className = 'stat';
    d.innerHTML = '<div class="value">' + h(pair[1]) + '</div><div class="label">' + h(pair[0]) + '</div>';
    summary.appendChild(d);
  });

  document.getElementById('explanation').textContent = report.explanation;

  var legendEl = document.getElementById('legend');
  typeOrder.forEach(function (t) {
    var sw = document.createElement('span');
    sw.className = 'sw';
    sw.innerHTML = '<span class="chip" style="background:' + typeColor[t] + '"></span>' + h(t);
    legendEl.appendChild(sw);
  });

  var chainEl = document.getElementById('chain');
  if (report.criticalChain.length === 0) {
    chainEl.innerHTML = '<div class="empty">No render-blocking resources found.</div>';
  } else {
    report.criticalChain.forEach(function (step, i) {
      var li = document.createElement('li');
      li.innerHTML = '<strong>' + (i + 1) + '. ' + h(step.resourceType) + '</strong> ' + h(step.url) +
        '<div class="meta">' + h(step.reason) + ' · finished at ' + h(fmtMs(step.endMs)) + ' · took ' + h(fmtMs(step.durationMs)) + '</div>';
      chainEl.appendChild(li);
    });
  }

  var criticalUrls = {};
  report.criticalChain.forEach(function (s) { criticalUrls[s.url] = true; });

  // Build a url -> entry index for initiator lookups (mirrors analyze.ts's matching rule).
  function findInitiatorEntry(entry) {
    if (!entry.initiatorUrl) return undefined;
    var best;
    for (var i = 0; i < report.entries.length; i++) {
      var c = report.entries[i];
      if (c.url !== entry.initiatorUrl) continue;
      if (c.startMs > entry.startMs) continue;
      if (!best || c.startMs > best.startMs) best = c;
    }
    return best;
  }
  var childrenOf = {};
  report.entries.forEach(function (e) {
    var parent = findInitiatorEntry(e);
    if (parent) {
      (childrenOf[parent.index] = childrenOf[parent.index] || []).push(e.index);
    }
  });
  function relatedIndices(entry) {
    var related = {};
    var cur = entry;
    while (cur) {
      related[cur.index] = true;
      cur = findInitiatorEntry(cur);
    }
    (function walkDown(idx) {
      (childrenOf[idx] || []).forEach(function (childIdx) {
        if (!related[childIdx]) { related[childIdx] = true; walkDown(childIdx); }
      });
    })(entry.index);
    return related;
  }

  var maxEnd = report.entries.reduce(function (m, e) { return Math.max(m, e.endMs); }, 1);
  var waterfallEl = document.getElementById('waterfall');
  var rulerEl = document.getElementById('ruler');
  var scrollEl = document.getElementById('wf-scroll');
  var tooltip = document.getElementById('tooltip');
  var zoom = 1;
  var selectedIndex = null;

  function buildRuler() {
    var trackWidth = 480 * zoom;
    var step = maxEnd <= 500 ? 50 : maxEnd <= 2000 ? 200 : maxEnd <= 6000 ? 500 : 1000;
    var ticks = '';
    for (var t = 0; t <= maxEnd; t += step) {
      var pct = (t / maxEnd) * 100;
      ticks += '<div class="tick" style="left:' + pct + '%">' + t + 'ms</div>';
    }
    rulerEl.innerHTML = '<div class="label"></div><div class="track" style="min-width:' + trackWidth + 'px">' + ticks + '</div><div class="label"></div>';
  }

  function render() {
    var thirdOnly = document.getElementById('third-party-only').checked;
    var blockOnly = document.getElementById('blocking-only').checked;
    waterfallEl.innerHTML = '';
    buildRuler();
    if (report.entries.length === 0) {
      waterfallEl.innerHTML = '<div class="empty">This capture has no requests.</div>';
      return;
    }
    var related = selectedIndex === null ? null : relatedIndices(report.entries[selectedIndex]);
    var trackWidth = 480 * zoom;
    var shown = 0;
    report.entries.forEach(function (e) {
      var visible = (!thirdOnly || e.thirdParty) && (!blockOnly || e.renderBlocking);
      var isRelated = related ? !!related[e.index] : true;
      var row = document.createElement('div');
      row.className = 'row' + (visible ? '' : ' dim') + (isRelated ? '' : ' dim') +
        (related && isRelated && e.index !== selectedIndex ? ' related' : '') +
        (e.index === selectedIndex ? ' selected' : '');
      row.addEventListener('click', function () {
        selectedIndex = selectedIndex === e.index ? null : e.index;
        render();
      });
      var name = document.createElement('div');
      name.className = 'name';
      name.title = e.url;
      var short = e.url.length > 58 ? e.url.slice(0, 55) + '…' : e.url;
      name.innerHTML = '<span class="type-dot" style="background:' + (typeColor[e.resourceType] || typeColor.other) + '"></span>' +
        h(short) + (e.thirdParty ? '<span class="badge">3rd party</span>' : '');
      var trackCell = document.createElement('div');
      trackCell.className = 'track-cell';
      var track = document.createElement('div');
      track.className = 'track';
      track.style.minWidth = trackWidth + 'px';
      var bar = document.createElement('div');
      bar.className = 'bar' + (criticalUrls[e.url] ? ' critical' : '') + (e.index === selectedIndex ? ' selected' : '');
      var left = (e.startMs / maxEnd) * 100;
      var width = Math.max(((e.endMs - e.startMs) / maxEnd) * 100, 0.3);
      bar.style.left = left + '%';
      bar.style.width = width + '%';
      bar.style.background = typeColor[e.resourceType] || typeColor.other;
      bar.addEventListener('mousemove', function (ev) {
        tooltip.style.display = 'block';
        tooltip.style.left = (ev.clientX + 14) + 'px';
        tooltip.style.top = (ev.clientY + 14) + 'px';
        tooltip.textContent = e.url + '\\n' + e.resourceType + ' · ' + e.status + '\\nstart ' + fmtMs(e.startMs) +
          ' · duration ' + fmtMs(e.durationMs) + '\\n' + fmtBytes(e.transferBytes) +
          (e.renderBlocking ? '\\nrender-blocking' : '') +
          (e.initiatorUrl ? '\\ninitiated by ' + e.initiatorUrl : '');
      });
      bar.addEventListener('mouseleave', function () { tooltip.style.display = 'none'; });
      track.appendChild(bar);
      trackCell.appendChild(track);
      var dur = document.createElement('div');
      dur.className = 'dur';
      dur.textContent = fmtMs(e.durationMs);
      row.appendChild(name);
      row.appendChild(trackCell);
      row.appendChild(dur);
      waterfallEl.appendChild(row);
      if (visible) shown++;
    });
    if (shown === 0) {
      waterfallEl.innerHTML = '<div class="empty">No requests match the current filters.</div>';
    }
  }
  document.getElementById('third-party-only').addEventListener('change', render);
  document.getElementById('blocking-only').addEventListener('change', render);
  document.getElementById('zoom-range').addEventListener('input', function (ev) {
    zoom = parseFloat(ev.target.value);
    render();
  });
  render();

  var table = document.getElementById('third-party-table');
  if (report.thirdPartyAttribution.length === 0) {
    document.querySelector('.table-wrap').innerHTML = '<div class="empty">No third-party requests detected.</div>';
  } else {
    var head = '<tr><th>Origin</th><th class="num">Requests</th><th class="num">Bytes</th><th class="num">% of page</th><th class="num">Blocking time</th></tr>';
    var rows = report.thirdPartyAttribution.map(function (t) {
      return '<tr><td>' + h(t.hostname) + '</td><td class="num">' + h(t.requestCount) + '</td><td class="num">' +
        h(fmtBytes(t.totalBytes)) + '</td><td class="num">' + h(t.pctOfPageBytes.toFixed(1)) + '%</td><td class="num">' +
        h(fmtMs(t.totalBlockingTimeMs)) + '</td></tr>';
    }).join('');
    table.innerHTML = head + rows;
  }
})();
</script>
</body>
</html>
`;
}
