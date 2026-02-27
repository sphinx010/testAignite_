/**
 * renderCharts.js
 * - Reads dashboard/data/runs.json
 * - Generates styled SVG charts into dashboard/charts/
 * - Generates dashboard/index.html (simple UI)
 *
 * Charts:
 *  1) pass_rate.svg     (green line)
 *  2) duration.svg      (yellow line)
 *  3) failures.svg      (donut summary: green pass / red fail)
 */

const fs = require("fs");
const path = require("path");

const dataFile = path.join("dashboard", "data", "runs.json");
const outChartsDir = path.join("dashboard", "charts");
const outIndex = path.join("dashboard", "index.html");

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function readRuns() {
  if (!fs.existsSync(dataFile)) return [];
  try {
    const raw = fs.readFileSync(dataFile, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function formatDateShort(iso) {
  try {
    const d = new Date(iso);
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${mm}/${dd}`;
  } catch {
    return "";
  }
}

function svgLineChart({
  title,
  subtitle,
  values,
  valueLabel,
  yMinOverride,
  yMaxOverride,
  color,
  fileName,
}) {
  const width = 980;
  const height = 360;

  // generous padding
  const padLeft = 68;
  const padRight = 26;
  const padTop = 72;
  const padBottom = 56;

  const bg = "#0b1220";
  const panel = "#0f1a2e";
  const grid = "#22314a";
  const text = "#e5e7eb";
  const muted = "#9ca3af";

  const innerW = width - padLeft - padRight;
  const innerH = height - padTop - padBottom;

  const safeValues = values.map((v) => (Number.isFinite(v) ? v : 0));

  const minV = Number.isFinite(yMinOverride)
    ? yMinOverride
    : Math.min(...safeValues, 0);
  const maxV = Number.isFinite(yMaxOverride)
    ? yMaxOverride
    : Math.max(...safeValues, 1);

  const span = maxV - minV || 1;

  const xFor = (i) =>
    padLeft + (safeValues.length <= 1 ? 0 : (i / (safeValues.length - 1)) * innerW);
  const yFor = (v) => padTop + (1 - (v - minV) / span) * innerH;

  // Path
  let d = "";
  const points = safeValues.map((v, i) => {
    const x = xFor(i);
    const y = yFor(v);
    d += i === 0 ? `M ${x} ${y}` : ` L ${x} ${y}`;
    return { x, y, v };
  });

  // Grid
  const gridLines = 5;
  let gridSvg = "";
  for (let i = 0; i <= gridLines; i++) {
    const y = padTop + (i / gridLines) * innerH;
    gridSvg += `<line x1="${padLeft}" y1="${y}" x2="${padLeft + innerW}" y2="${y}" stroke="${grid}" stroke-dasharray="5 6" stroke-width="1" />`;
  }

  // Y labels
  let yLabels = "";
  for (let i = 0; i <= gridLines; i++) {
    const value = maxV - (i / gridLines) * span;
    const y = padTop + (i / gridLines) * innerH;
    yLabels += `
      <text x="${padLeft - 12}" y="${y + 5}" text-anchor="end" fill="${muted}" font-size="12">
        ${Math.round(value)}
      </text>`;
  }

  // X labels (first/mid/last)
  const xLabels = [];
  if (safeValues.length > 0) {
    xLabels.push({ i: 0, label: "Run 1" });
    if (safeValues.length > 2) xLabels.push({ i: Math.floor((safeValues.length - 1) / 2), label: "Mid" });
    if (safeValues.length > 1) xLabels.push({ i: safeValues.length - 1, label: `Run ${safeValues.length}` });
  }

  let xLabelSvg = "";
  xLabels.forEach(({ i, label }) => {
    const x = xFor(i);
    xLabelSvg += `<text x="${x}" y="${padTop + innerH + 28}" text-anchor="middle" fill="${muted}" font-size="12">${label}</text>`;
  });

  const last = safeValues.length ? safeValues[safeValues.length - 1] : 0;

  const badge = `
    <g>
      <rect x="${padLeft}" y="22" rx="12" ry="12" width="230" height="30" fill="${panel}" stroke="${grid}" />
      <circle cx="${padLeft + 18}" cy="37" r="6" fill="${color}" />
      <text x="${padLeft + 34}" y="42" fill="${text}" font-size="12" font-weight="700">
        Latest: ${last} ${valueLabel}
      </text>
    </g>
  `;

  const svg = `
  <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <defs>
      <linearGradient id="lineGlow_${fileName}" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="${color}" stop-opacity="0.15"/>
        <stop offset="1" stop-color="${color}" stop-opacity="0.45"/>
      </linearGradient>
    </defs>

    <rect x="0" y="0" width="${width}" height="${height}" fill="${bg}"/>
    <rect x="18" y="14" width="${width - 36}" height="${height - 28}" rx="18" fill="${panel}"/>

    <text x="${padLeft}" y="52" fill="${text}" font-size="20" font-weight="800">${title}</text>
    <text x="${padLeft}" y="68" fill="${muted}" font-size="12">${subtitle}</text>

    ${badge}

    ${gridSvg}

    <line x1="${padLeft}" y1="${padTop}" x2="${padLeft}" y2="${padTop + innerH}" stroke="${grid}" stroke-width="1.5"/>
    <line x1="${padLeft}" y1="${padTop + innerH}" x2="${padLeft + innerW}" y2="${padTop + innerH}" stroke="${grid}" stroke-width="1.5"/>

    ${yLabels}
    ${xLabelSvg}

    <path d="${d}" fill="none" stroke="url(#lineGlow_${fileName})" stroke-width="10" stroke-linecap="round" opacity="0.65"/>
    <path d="${d}" fill="none" stroke="${color}" stroke-width="4" stroke-linecap="round"/>

    ${points
      .map(
        (p) => `<circle cx="${p.x}" cy="${p.y}" r="5.5" fill="${bg}" stroke="${color}" stroke-width="2"/>`
      )
      .join("")}

    <text x="${width - padRight}" y="${height - 18}" text-anchor="end" fill="${muted}" font-size="11">
      Opex QA Dashboard • generated by GitHub Actions
    </text>
  </svg>`;

  fs.writeFileSync(path.join(outChartsDir, fileName), svg.trim(), "utf8");
}

function svgDonutSummaryChart({ run, fileName }) {
  const width = 900;
  const height = 460;

  const bgTop = "#1f2430";
  const bgBottom = "#1b1f2a";
  const panel = "#232836";
  const grid = "#2f3546";
  const text = "#eef1f6";
  const muted = "#c4cad6";
  const green = "#3fa15a";
  const red = "#b33430";

  const passes = Number(run && run.passes) || 0;
  const failures = Number(run && run.failures) || 0;
  const total = Math.max(passes + failures, 0);

  const passPct = total > 0 ? (passes / total) * 100 : 0;
  const failPct = total > 0 ? (failures / total) * 100 : 0;

  const passPctText = `${passPct.toFixed(1)}%`;
  const failPctText = `${failPct.toFixed(1)}%`;

  const cx = Math.round(width * 0.5);
  const cy = 255;
  const outerR = 130;
  const innerR = 70;

  const startAngle = -90;
  const passAngle = (360 * passPct) / 100;
  const failAngle = (360 * failPct) / 100;

  function pointFor(cx0, cy0, r, angleDeg) {
    const rad = ((angleDeg - 90) * Math.PI) / 180;
    return { x: cx0 + r * Math.cos(rad), y: cy0 + r * Math.sin(rad) };
  }

  function donutSegmentPath(cx0, cy0, rOuter, rInner, a0, a1) {
    const startOuter = pointFor(cx0, cy0, rOuter, a0);
    const endOuter = pointFor(cx0, cy0, rOuter, a1);
    const startInner = pointFor(cx0, cy0, rInner, a1);
    const endInner = pointFor(cx0, cy0, rInner, a0);
    const largeArc = a1 - a0 > 180 ? 1 : 0;

    return [
      `M ${startOuter.x} ${startOuter.y}`,
      `A ${rOuter} ${rOuter} 0 ${largeArc} 1 ${endOuter.x} ${endOuter.y}`,
      `L ${startInner.x} ${startInner.y}`,
      `A ${rInner} ${rInner} 0 ${largeArc} 0 ${endInner.x} ${endInner.y}`,
      "Z",
    ].join(" ");
  }

  let passArc = "";
  let failArc = "";
  if (total > 0) {
    passArc = donutSegmentPath(cx, cy, outerR, innerR, startAngle, startAngle + passAngle);
    failArc = donutSegmentPath(
      cx,
      cy,
      outerR,
      innerR,
      startAngle + passAngle,
      startAngle + passAngle + failAngle
    );
  } else {
    passArc = donutSegmentPath(cx, cy, outerR, innerR, startAngle, startAngle + 360);
  }

  const svg = `
  <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <defs>
      <linearGradient id="bgFade" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="${bgTop}"/>
        <stop offset="1" stop-color="${bgBottom}"/>
      </linearGradient>
      <filter id="softShadow" x="-30%" y="-30%" width="160%" height="160%">
        <feDropShadow dx="0" dy="6" stdDeviation="8" flood-color="#000" flood-opacity="0.35"/>
      </filter>
    </defs>

    <rect x="0" y="0" width="${width}" height="${height}" fill="url(#bgFade)"/>

    <text x="36" y="44" fill="${text}" font-size="20" font-weight="700" font-family="Trebuchet MS, Lucida Sans Unicode, Lucida Grande, sans-serif">
      #### Test Results
    </text>
    <line x1="36" y1="58" x2="${width - 36}" y2="58" stroke="${grid}" stroke-width="1"/>

    <text x="36" y="98" fill="${text}" font-size="18" font-weight="600" font-family="Trebuchet MS, Lucida Sans Unicode, Lucida Grande, sans-serif">
      Test Summary
    </text>

    <text x="72" y="158" fill="${text}" font-size="15" font-family="Trebuchet MS, Lucida Sans Unicode, Lucida Grande, sans-serif">
      <tspan fill="${green}" font-weight="700">- Green:</tspan>
      <tspan> ${passes} tests passed</tspan>
    </text>
    <text x="${width - 300}" y="158" fill="${text}" font-size="15" font-family="Trebuchet MS, Lucida Sans Unicode, Lucida Grande, sans-serif">
      <tspan fill="${red}" font-weight="700">- Red:</tspan>
      <tspan> ${failures} tests failed</tspan>
    </text>

    <g filter="url(#softShadow)">
      <path d="${passArc}" fill="${total > 0 ? green : panel}"/>
      ${failures > 0 ? `<path d="${failArc}" fill="${red}"/>` : ""}
    </g>

    <circle cx="${cx}" cy="${cy}" r="${innerR - 6}" fill="${panel}"/>

    <text x="${cx + 80}" y="${cy - 58}" fill="${red}" font-size="14" font-weight="700" font-family="Trebuchet MS, Lucida Sans Unicode, Lucida Grande, sans-serif">
      Failed: ${failures} Tests
    </text>
    <text x="${cx + 96}" y="${cy - 38}" fill="${text}" font-size="14" font-weight="700" font-family="Trebuchet MS, Lucida Sans Unicode, Lucida Grande, sans-serif">
      ${failPctText}
    </text>

    <text x="${cx}" y="${cy + 46}" fill="${text}" text-anchor="middle" font-size="16" font-weight="700" font-family="Trebuchet MS, Lucida Sans Unicode, Lucida Grande, sans-serif">
      Passed: ${passes} Tests
    </text>
    <text x="${cx}" y="${cy + 68}" fill="${text}" text-anchor="middle" font-size="16" font-weight="700" font-family="Trebuchet MS, Lucida Sans Unicode, Lucida Grande, sans-serif">
      ${passPctText}
    </text>

    <text x="${cx}" y="${height - 50}" fill="${text}" text-anchor="middle" font-size="14" font-family="Trebuchet MS, Lucida Sans Unicode, Lucida Grande, sans-serif">
      - ${passPctText} of tests passed
    </text>
    <text x="${cx}" y="${height - 28}" fill="${text}" text-anchor="middle" font-size="14" font-family="Trebuchet MS, Lucida Sans Unicode, Lucida Grande, sans-serif">
      - ${failPctText} of tests failed
    </text>
  </svg>`;

  fs.writeFileSync(path.join(outChartsDir, fileName), svg.trim(), "utf8");
}

function svgCiListTable({ run, fileName }) {
  const passes = run.passedTests || [];
  const fails = run.failedTests || [];
  const all = [...fails, ...passes].slice(0, 15); // Limit for readability

  const width = 600;
  const itemHeight = 32;
  const headerHeight = 60;
  const height = headerHeight + (all.length || 1) * itemHeight + 20;

  const bg = "#0b1220";
  const panel = "#0f1a2e";
  const text = "#ffffff"; // White for general/passed
  const red = "#ef4444"; // Red for failed
  const muted = "#9ca3af";

  let listItems = "";
  all.forEach((name, i) => {
    const isFail = i < fails.length;
    const y = headerHeight + i * itemHeight;
    const color = isFail ? red : text;
    const icon = isFail ? "×" : "✓";

    listItems += `
      <g transform="translate(20, ${y})">
        <text x="0" y="20" fill="${color}" font-size="16" font-weight="700" font-family="Segoe UI, system-ui, sans-serif">${icon}</text>
        <text x="25" y="20" fill="${color}" font-size="14" font-family="Segoe UI, system-ui, sans-serif" clip-path="url(#clipText)">${name}</text>
      </g>
    `;
  });

  if (!all.length) {
    listItems = `<text x="50%" y="100" text-anchor="middle" fill="${muted}" font-size="14">No test results available for this run.</text>`;
  }

  const svg = `
  <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <defs>
      <clipPath id="clipText">
        <rect x="25" y="0" width="${width - 60}" height="30" />
      </clipPath>
    </defs>
    <rect x="0" y="0" width="${width}" height="${height}" rx="12" fill="${bg}" />
    <rect x="10" y="10" width="${width - 20}" height="${height - 20}" rx="10" fill="${panel}" />
    
    <text x="20" y="42" fill="${text}" font-size="20" font-weight="800" font-family="Segoe UI, system-ui, sans-serif">CI Status: Reflective Insights</text>
    <line x1="20" y1="52" x2="${width - 20}" y2="52" stroke="${muted}" stroke-width="0.5" opacity="0.3" />

    ${listItems}

    <text x="${width - 20}" y="${height - 15}" text-anchor="end" fill="${muted}" font-size="10" font-family="Segoe UI">Generated by AIgnite Framework</text>
  </svg>`;

  fs.writeFileSync(path.join(outChartsDir, fileName), svg.trim(), "utf8");
}

function svgStackedResultsChart({ runs, fileName }) {
  const width = 980;
  const height = 360;

  const padLeft = 68;
  const padRight = 26;
  const padTop = 72;
  const padBottom = 56;

  const bg = "#0b1220";
  const panel = "#0f1a2e";
  const grid = "#22314a";
  const text = "#e5e7eb";
  const muted = "#9ca3af";

  const green = "#22c55e";
  const red = "#ef4444";
  const yellow = "#facc15";

  const innerW = width - padLeft - padRight;
  const innerH = height - padTop - padBottom;

  const n = runs.length;
  const maxTotal = Math.max(...runs.map((r) => Number(r.tests) || 0), 1);

  // grid
  const gridLines = 5;
  let gridSvg = "";
  for (let i = 0; i <= gridLines; i++) {
    const y = padTop + (i / gridLines) * innerH;
    gridSvg += `<line x1="${padLeft}" y1="${y}" x2="${padLeft + innerW}" y2="${y}" stroke="${grid}" stroke-dasharray="5 6" stroke-width="1" />`;
  }

  // y labels
  let yLabels = "";
  for (let i = 0; i <= gridLines; i++) {
    const value = Math.round(maxTotal - (i / gridLines) * maxTotal);
    const y = padTop + (i / gridLines) * innerH;
    yLabels += `<text x="${padLeft - 12}" y="${y + 5}" text-anchor="end" fill="${muted}" font-size="12">${value}</text>`;
  }

  // bars
  const barGap = 8;
  const slotW = n > 0 ? innerW / n : innerW;
  const barW = Math.max(6, slotW - barGap);

  let bars = "";
  runs.forEach((r, i) => {
    const passes = Number(r.passes) || 0;
    const failures = Number(r.failures) || 0;
    const pending = Number(r.pending) || 0;

    const x = padLeft + i * slotW + barGap / 2;

    const hPass = (passes / maxTotal) * innerH;
    const hFail = (failures / maxTotal) * innerH;
    const hPend = (pending / maxTotal) * innerH;

    const yBase = padTop + innerH;

    const yPass = yBase - hPass;
    const yFail = yPass - hFail;
    const yPend = yFail - hPend;

    if (hPass > 0) bars += `<rect x="${x}" y="${yPass}" width="${barW}" height="${hPass}" rx="6" fill="${green}" />`;
    if (hFail > 0) bars += `<rect x="${x}" y="${yFail}" width="${barW}" height="${hFail}" rx="6" fill="${red}" />`;
    if (hPend > 0) bars += `<rect x="${x}" y="${yPend}" width="${barW}" height="${hPend}" rx="6" fill="${yellow}" />`;
  });

  const last = runs[n - 1] || { tests: 0, passes: 0, failures: 0, pending: 0 };

  const badge = `
    <g>
      <rect x="${padLeft}" y="22" rx="12" ry="12" width="440" height="30" fill="${panel}" stroke="${grid}" />
      <text x="${padLeft + 16}" y="42" fill="${text}" font-size="12" font-weight="700">
        Latest: ${last.passes}/${last.tests} passed • ${last.failures} failed • ${last.pending} pending
      </text>
    </g>
  `;

  const legend = `
    <g>
      <rect x="${width - 320}" y="22" rx="12" ry="12" width="280" height="30" fill="${panel}" stroke="${grid}" />
      <circle cx="${width - 292}" cy="37" r="6" fill="${green}" />
      <text x="${width - 278}" y="41" fill="${text}" font-size="12">Pass</text>
      <circle cx="${width - 230}" cy="37" r="6" fill="${red}" />
      <text x="${width - 216}" y="41" fill="${text}" font-size="12">Fail</text>
      <circle cx="${width - 170}" cy="37" r="6" fill="${yellow}" />
      <text x="${width - 156}" y="41" fill="${text}" font-size="12">Pending</text>
    </g>
  `;

  const svg = `
  <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <rect x="0" y="0" width="${width}" height="${height}" fill="${bg}"/>
    <rect x="18" y="14" width="${width - 36}" height="${height - 28}" rx="18" fill="${panel}"/>

    <text x="${padLeft}" y="52" fill="${text}" font-size="20" font-weight="800">Results per Run (Pass/Fail)</text>
    <text x="${padLeft}" y="68" fill="${muted}" font-size="12">Stacked bars • last ${n} runs</text>

    ${badge}
    ${legend}

    ${gridSvg}

    <line x1="${padLeft}" y1="${padTop}" x2="${padLeft}" y2="${padTop + innerH}" stroke="${grid}" stroke-width="1.5"/>
    <line x1="${padLeft}" y1="${padTop + innerH}" x2="${padLeft + innerW}" y2="${padTop + innerH}" stroke="${grid}" stroke-width="1.5"/>

    ${yLabels}
    ${bars}

    <text x="${width - padRight}" y="${height - 18}" text-anchor="end" fill="${muted}" font-size="11">
      Opex QA Dashboard • generated by GitHub Actions
    </text>
  </svg>`;

  fs.writeFileSync(path.join(outChartsDir, fileName), svg.trim(), "utf8");
}

function writeDashboardIndex(runs) {
  const latest = runs.length ? runs[runs.length - 1] : null;

  const latestSummary = latest
    ? `
      <div class="grid">
        <div class="card green">
          <div class="label">Pass Rate</div>
          <div class="value">${latest.passRate}%</div>
          <div class="meta">${latest.passes}/${latest.tests} passed</div>
        </div>

        <div class="card yellow">
          <div class="label">Duration</div>
          <div class="value">${latest.durationSec}s</div>
          <div class="meta">Latest run</div>
        </div>

        <div class="card red">
          <div class="label">Failures</div>
          <div class="value">${latest.failures}</div>
          <div class="meta">Latest run</div>
        </div>
      </div>
    `
    : `<div class="empty">No run data yet. Push a commit to trigger CI.</div>`;

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Opex QA Dashboard</title>
  <style>
    :root{
      --bg:#0b1220;
      --panel:#0f1a2e;
      --muted:#9ca3af;
      --text:#e5e7eb;
      --border:#22314a;
      --green:#22c55e;
      --yellow:#facc15;
      --red:#ef4444;
    }
    body{
      margin:0;
      background: radial-gradient(1200px 600px at 15% 15%, #132445 0%, var(--bg) 55%);
      color:var(--text);
      font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial, "Helvetica Neue";
    }
    .wrap{max-width:1100px;margin:0 auto;padding:28px 16px 48px;}
    .header{
      background: linear-gradient(135deg, #0d47a1, #1976d2, #42a5f5);
      border-radius:18px;
      padding:22px 22px;
      box-shadow:0 18px 50px rgba(0,0,0,.45);
      border:1px solid rgba(255,255,255,.08);
    }
    .header h1{margin:0;font-size:22px;letter-spacing:.3px}
    .header p{margin:6px 0 0;color:#e3f2fd;font-size:13px}
    .grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:18px 0 10px;}
    .card{
      background: rgba(15,26,46,.85);
      border:1px solid var(--border);
      border-radius:16px;
      padding:14px 16px;
      box-shadow: 0 10px 30px rgba(0,0,0,.25);
    }
    .label{color:var(--muted);font-size:12px}
    .value{font-size:28px;font-weight:800;margin-top:6px}
    .meta{color:var(--muted);font-size:12px;margin-top:2px}
    .green .value{color:var(--green)}
    .yellow .value{color:var(--yellow)}
    .red .value{color:var(--red)}
    .charts{display:flex;flex-direction:column;gap:14px;margin-top:14px}
    .charts img{width:100%;border-radius:18px;border:1px solid rgba(255,255,255,.08)}
    .links{margin-top:14px;color:var(--muted);font-size:13px}
    .links a{color:#7dd3fc;text-decoration:none}
    .links a:hover{text-decoration:underline}
    .empty{margin:18px 0;color:var(--muted)}
    @media (max-width: 900px){ .grid{grid-template-columns:1fr} }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="header">
      <h1>📊 Opex QA Automation Dashboard</h1>
      <p>Updated automatically by GitHub Actions after each run (last 30 runs).</p>
    </div>

    ${latestSummary}

    <div class="charts">
      <img src="charts/pass_rate.svg" alt="Pass rate trend"/>
      <img src="charts/duration.svg" alt="Duration trend"/>
      <img src="charts/failures.svg" alt="Pass vs fail summary"/>
    </div>

    <div class="links">
      Data file: <a href="data/runs.json">runs.json</a>
    </div>
  </div>
</body>
</html>`;

  fs.writeFileSync(outIndex, html, "utf8");
}

function main() {
  ensureDir(outChartsDir);

  const runs = readRuns();

  const passRates = runs.map((r) => Number(r.passRate) || 0);
  const durations = runs.map((r) => Number(r.durationSec) || 0);

  const firstTs = runs.length ? formatDateShort(runs[0].ts) : "";
  const lastTs = runs.length ? formatDateShort(runs[runs.length - 1].ts) : "";
  const range = firstTs && lastTs ? `${firstTs} → ${lastTs}` : "No data yet";

  // Pass Rate
  svgLineChart({
    title: "Pass Rate Trend",
    subtitle: `Last ${runs.length} runs • ${range}`,
    values: passRates,
    valueLabel: "%",
    yMinOverride: 0,
    yMaxOverride: 100,
    color: "#22c55e",
    fileName: "pass_rate.svg",
  });

  // Duration
  const maxDur = Math.max(...durations, 1);
  svgLineChart({
    title: "Duration Trend (seconds)",
    subtitle: `Last ${runs.length} runs • ${range}`,
    values: durations,
    valueLabel: "s",
    yMinOverride: 0,
    yMaxOverride: Math.ceil(maxDur * 1.15),
    color: "#facc15",
    fileName: "duration.svg",
  });

  // Results Stacked (Pass/Fail/Pending)
  const latest = runs.length
    ? runs[runs.length - 1]
    : { tests: 0, passes: 0, failures: 0, pending: 0 };

  svgDonutSummaryChart({
    run: latest,
    fileName: "failures.svg",
  });

  // Reflective CI List SVG
  svgCiListTable({
    run: latest,
    fileName: "ci_list.svg",
  });

  writeDashboardIndex(runs);

  console.log("✅ Charts + dashboard generated:");
  console.log(`   ${path.join(outChartsDir, "pass_rate.svg")}`);
  console.log(`   ${path.join(outChartsDir, "duration.svg")}`);
  console.log(`   ${path.join(outChartsDir, "failures.svg")}`);
  console.log(`   ${path.join(outChartsDir, "ci_list.svg")}`);
  console.log(`   ${outIndex}`);
}

main();
