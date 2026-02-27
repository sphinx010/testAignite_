// Offline-first: no network calls or CDN dependencies.
const REPORT_BASE = "../";
const REPORT_JSON_PATH = "../cypress/reports/results.json";

// Canonical status labels/colors used across UI.
const STATUS_META = {
  passed: { label: "PASS", color: "#2FCF86" },
  failed: { label: "FAIL", color: "#E84B5C" },
  skipped: { label: "SKIP", color: "#A78BFA" },
  pending: { label: "PENDING", color: "#F3B34D" },
};

// UI state + cached report data.
const state = {
  mode: "interactive",
  reportUrl: "",
  reportSignature: "",
  stats: null,
  reportData: null,
  tests: [],
  suites: [],
  filter: "all",
  search: "",
  donutLocked: false,
  autoMode: true,
  history: [],
};

let lastMetricsStats = null;

const isStatic = new URLSearchParams(window.location.search).get("mode") === "static";
state.mode = isStatic ? "static" : "interactive";

// If Chart.js is present, hide point markers but keep hit radius for tooltips.
if (typeof window !== "undefined" && window.Chart) {
  const d = window.Chart.defaults;
  // Chart.js v3+
  if (d?.elements?.point) {
    d.elements.point.radius = 0;
    d.elements.point.hoverRadius = 0;
    d.elements.point.hitRadius = 10;
  }
  // Chart.js v2 fallback
  if (d?.global?.elements?.point) {
    d.global.elements.point.radius = 0;
    d.global.elements.point.hoverRadius = 0;
    d.global.elements.point.hitRadius = 10;
  }
  if (d?.datasets?.line) {
    d.datasets.line.pointRadius = 0;
    d.datasets.line.pointHoverRadius = 0;
    d.datasets.line.pointHitRadius = 10;
  }
}

// Cached DOM nodes.
const ui = {
  app: document.querySelector(".app"),
  lastUpdated: document.getElementById("last-updated"),
  statusChip: document.getElementById("status-chip"),
  modeChip: document.getElementById("mode-chip"),
  errorCard: document.getElementById("error-card"),
  errorList: document.getElementById("error-list"),
  donutGroup: document.getElementById("donut-group"),
  totalTests: document.getElementById("total-tests"),
  centerLabel: document.getElementById("center-label"),
  centerSub: document.getElementById("center-sub"),
  speedChart: document.getElementById("speed-chart"),
  speedFastest: document.getElementById("speed-fastest"),
  speedSlowest: document.getElementById("speed-slowest"),
  trend: {
    tests: document.getElementById("trend-tests"),
    passRate: document.getElementById("trend-passrate"),
    fail: document.getElementById("trend-fail"),
    runtime: document.getElementById("trend-runtime"),
    testsValue: document.getElementById("trend-tests-value"),
    passRateValue: document.getElementById("trend-passrate-value"),
    failValue: document.getElementById("trend-fail-value"),
    runtimeValue: document.getElementById("trend-runtime-value"),
  },
  suiteList: document.getElementById("suite-list"),
  testsBody: document.getElementById("tests-body"),
  searchInput: document.getElementById("search-input"),
  filterButtons: Array.from(document.querySelectorAll(".pill")),
  sourceInput: document.getElementById("source-input"),
  loadBtn: document.getElementById("load-btn"),
  fileInput: document.getElementById("file-input"),
  fileName: document.getElementById("file-name"),
  refreshBtn: document.getElementById("refresh-btn"),
  downloadBtn: document.getElementById("download-btn"),
  themeToggle: document.getElementById("theme-toggle"),
  navOpen: document.getElementById("nav-open"),
  navClose: document.getElementById("nav-close"),
  navOverlay: document.getElementById("nav-overlay"),
  tooltip: document.getElementById("tooltip"),
  insightsBtn: document.getElementById("insights-btn"),
  insightsModal: document.getElementById("insights-modal"),
  insightsClose: document.getElementById("insights-close"),
  insightsList: document.getElementById("insights-list"),
};

// Always reveal the app once DOM is ready (even if data isn't loaded).
document.addEventListener("DOMContentLoaded", () => {
  if (ui.app) ui.app.classList.add("loaded");
});

if (ui.modeChip) {
  ui.modeChip.textContent = state.mode.toUpperCase();
}

// Apply theme + update toggle label.
function applyTheme(theme) {
  document.body.classList.add("theme-switching");
  document.body.dataset.theme = theme;
  if (ui.themeToggle) {
    ui.themeToggle.textContent = theme === "dark" ? "Light mode" : "Dark mode";
  }
  // Remove the no-transition guard after paint.
  setTimeout(() => document.body.classList.remove("theme-switching"), 80);
}

// Initialize theme from localStorage, default to light.
function initTheme() {
  const saved = localStorage.getItem("theme");
  if (saved === "dark" || saved === "light") {
    applyTheme(saved);
    return;
  }
  applyTheme("light");
}

// Update "Last updated" timestamp.
function setLastUpdated() {
  ui.lastUpdated.textContent = `Last updated: ${new Date().toLocaleString()}`;
}

// Show report load errors in the UI.
function showError(attempts) {
  ui.errorList.innerHTML = "";
  attempts.forEach((attempt) => {
    const li = document.createElement("li");
    li.textContent = `${attempt.url} (${attempt.status})`;
    ui.errorList.appendChild(li);
  });
  ui.errorCard.classList.remove("hidden");
  if (ui.app) ui.app.classList.add("loaded");
}

// Hide error card.
function hideError() {
  ui.errorCard.classList.add("hidden");
}

async function fetchReport(path, quiet = false) {
  // Check for pre-injected data (Offline Report Mode)
  if (window.TESTAIGNITE_DATA) {
    console.log("[TestAIgnite] Using offline data payload");
    handleReport(window.TESTAIGNITE_DATA, "offline-report.html");
    hideError();
    return;
  }

  try {
    const res = await fetch(path, { cache: "no-store" });
    if (!res.ok) throw new Error(res.statusText || "FETCH_ERROR");
    const data = await res.json();
    handleReport(data, path);
    hideError();
  } catch (err) {
    if (!quiet) {
      showError([{ url: path, status: err.message || "LOAD_FAILED" }]);
    }
  }
}

// Normalize report path for local file inputs.
function normalizeReportPath(input) {
  if (!input) return "";
  const trimmed = input.trim();
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return trimmed;
  const normalized = trimmed.replace(/\\/g, "/");
  if (normalized.startsWith("../") || normalized.startsWith("./") || normalized.startsWith("/")) {
    return normalized;
  }
  if (normalized.includes("/")) {
    return `../${normalized}`;
  }
  return `${REPORT_BASE}${normalized}`;
}

// Read a local JSON report from file input.
function loadFromFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      handleReport(data, file.name);
      hideError();
    } catch (err) {
      showError([{ url: file.name, status: "INVALID_JSON" }]);
    }
  };
  reader.readAsText(file);
}

// Map Mochawesome test flags to canonical status.
function normalizeStatus(test) {
  if (test.skipped) return "skipped";
  if (test.pending) return "pending";
  if (test.state === "failed" || test.fail) return "failed";
  if (test.state === "passed" || test.pass) return "passed";
  return "pending";
}

// Extract tag strings in [TAG] format.
function extractTags(title) {
  const tags = [];
  const regex = /\[([^\]]+)\]/g;
  let match = regex.exec(title);
  while (match) {
    tags.push(match[1]);
    match = regex.exec(title);
  }
  return tags;
}

// Extract AI metadata (populated externally, e.g. by Mistral) with safe defaults.
function extractAIMeta(test) {
  const ai = test.ai || test.meta || {};
  return {
    aiSeverity: ai.severity || "",
    aiPriority: ai.priority || "",
    aiImpact: ai.bugEffect || ai.impact || "",
    aiSummary: ai.summary || ai.humanSummary || "",
    aiHumanError: ai.humanError || "",
    aiTestRootCause: ai.testRootCause || "",
    aiProductRootCause: ai.productRootCause || "",
    aiExpected: ai.inferredExpected || "",
    aiFix: ai.recommendation || ai.fix || "",
    aiTags: Array.isArray(ai.tags) ? ai.tags : [],
    aiModel: ai.modelUsed || "AI Analysis"
  };
}

// Try to find a screenshot path embedded in error context.
function extractScreenshot(context) {
  if (!context) return "";
  let ctxStr = typeof context === "string" ? context : JSON.stringify(context);

  // Try to find base64 embedded image (common in embeddedScreenshots: true)
  if (ctxStr.includes("data:image")) {
    const b64 = ctxStr.match(/data:image\/[^;]+;base64,[^"']+/);
    if (b64) return b64[0];
  }

  const quoted = ctxStr.match(/["']([^"']+\.(png|jpg|jpeg|gif))["']/i);
  if (quoted && quoted[1]) return normalizeScreenshotPath(quoted[1]);
  // Fallback for raw paths without quotes
  const raw = ctxStr.match(/([^\s"']+\.(png|jpg|jpeg|gif))/i);
  if (raw && raw[1]) return normalizeScreenshotPath(raw[1]);
  return "";
}

// Normalize screenshot paths to report base (anchored on 'screenshots/').
function normalizeScreenshotPath(rawPath) {
  if (!rawPath) return "";

  // 1. Normalize slashes: convert all \ to / and collapse repetitions (handling heavy escaping)
  let path = rawPath.replace(/\\+/g, "/").replace(/\/+/g, "/");

  if (path.startsWith("http://") || path.startsWith("https://")) return path;

  // 2. Remove leading slashes and relative markers to get a clean sub-path
  path = path.replace(/^(\.\.\/|\.\/|\/+)+/, "");

  // 3. Anchoring: Ensure "screenshots/" is the root of the relative path
  const ssIdx = path.indexOf("screenshots/");
  if (ssIdx !== -1) {
    path = path.slice(ssIdx);
  } else {
    // If "screenshots/" is missing, the reporter is likely giving a path 
    // relative to the screenshots folder itself.
    path = "screenshots/" + path;
  }

  // 4. Resolve against REPORT_BASE (../)
  return `${REPORT_BASE}${path}`;
}

// Walk Mochawesome results and flatten test list.
function collectTests(report) {
  const results = Array.isArray(report?.results) ? report.results : [];
  const tests = [];
  const suites = new Set();

  function walkSuite(suite) {
    if (!suite) return;
    if (suite.title) suites.add(suite.title);
    (suite.tests || []).forEach((test) => {
      const status = normalizeStatus(test);
      const duration = Number(test.duration || 0);
      const tags = extractTags(test.title || "");
      const errorMessage = test.err?.message || test.err?.estack || "";
      const ai = extractAIMeta(test);
      tests.push({
        status,
        title: test.title || "(untitled)",
        duration,
        tags,
        errorMessage,
        screenshot: extractScreenshot(test.context),
        suite: test.suite || "Core",
        ...ai,
      });
    });
    (suite.suites || []).forEach(walkSuite);
  }

  results.forEach((result) => {
    // Determine a fallback name for the spec/result set
    const specFile = result.file || result.fullFile || "";
    const specName = specFile ? specFile.split(/[/\\]/).pop().replace(/\.cy\.js$|\.js$/, "") : "";
    const suiteTitle = result.title || specName || "Core";

    if (suiteTitle && suiteTitle !== "Core") suites.add(suiteTitle);

    // Some Mochawesome exports include tests directly on the result object.
    (result.tests || []).forEach((test) => {
      const status = normalizeStatus(test);
      const duration = Number(test.duration || 0);
      const tags = extractTags(test.title || "");
      const errorMessage = test.err?.message || test.err?.estack || "";
      const ai = extractAIMeta(test);
      tests.push({
        status,
        title: test.title || "(untitled)",
        duration,
        tags,
        errorMessage,
        screenshot: extractScreenshot(test.context),
        suite: suiteTitle,
        ...ai,
      });
    });
    (result.suites || []).forEach(walkSuite);
  });

  return { tests, suites: Array.from(suites) };
}

// Compute stats with fallback if report.stats is missing.
function computeStats(stats, tests) {
  const fallback = {
    tests: tests.length,
    passes: tests.filter((t) => t.status === "passed").length,
    failures: tests.filter((t) => t.status === "failed").length,
    skipped: tests.filter((t) => t.status === "skipped").length,
    pending: tests.filter((t) => t.status === "pending").length,
    duration: tests.reduce((acc, t) => acc + (t.duration || 0), 0),
    passPercent: tests.length ? (tests.filter((t) => t.status === "passed").length / tests.length) * 100 : 0,
  };

  return {
    tests: stats?.tests ?? fallback.tests,
    passes: stats?.passes ?? fallback.passes,
    failures: stats?.failures ?? fallback.failures,
    skipped: stats?.skipped ?? fallback.skipped,
    pending: stats?.pending ?? fallback.pending,
    duration: stats?.duration ?? fallback.duration,
    passPercent: stats?.passPercent ?? fallback.passPercent,
  };
}

// Build a cheap signature to avoid redundant renders.
function buildSignature(stats, tests) {
  const end = stats?.end || "";
  const duration = stats?.duration || 0;
  const total = stats?.tests || tests.length;
  return `${end}|${duration}|${total}`;
}

// Tween numbers (disabled in static mode).
function animateValue(el, from, to, formatter, duration = 900) {
  if (isStatic) {
    el.textContent = formatter(to);
    return;
  }
  const start = performance.now();
  function tick(now) {
    const progress = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - progress, 3);
    const value = from + (to - from) * eased;
    el.textContent = formatter(value);
    if (progress < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

// Tween progress bars (disabled in static mode).
function animateWidth(el, toPercent, duration = 800) {
  if (!el) return;
  if (isStatic) {
    el.style.width = `${toPercent}%`;
    return;
  }
  const start = performance.now();
  const fromPercent = 0;
  function tick(now) {
    const progress = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - progress, 3);
    const value = fromPercent + (toPercent - fromPercent) * eased;
    el.style.width = `${value}%`;
    if (progress < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

// SVG arc builder for donut.
function describeArc(cx, cy, r, startAngle, endAngle) {
  const start = polarToCartesian(cx, cy, r, endAngle);
  const end = polarToCartesian(cx, cy, r, startAngle);
  const largeArcFlag = endAngle - startAngle <= 180 ? "0" : "1";
  return [
    "M",
    start.x,
    start.y,
    "A",
    r,
    r,
    0,
    largeArcFlag,
    0,
    end.x,
    end.y,
  ].join(" ");
}

function polarToCartesian(cx, cy, r, angleInDegrees) {
  const angleInRadians = (angleInDegrees * Math.PI) / 180.0;
  return {
    x: cx + r * Math.cos(angleInRadians),
    y: cy + r * Math.sin(angleInRadians),
  };
}

// Render donut segments.
function renderDonut(counts, total, progress = 1) {
  ui.donutGroup.innerHTML = "";
  if (!total) return;

  const ordered = ["passed", "failed", "skipped", "pending"];
  const sweep = 360 * progress;
  let startAngle = 0;
  const radius = 98;

  ordered.forEach((status) => {
    const value = counts[status] || 0;
    const share = total ? value / total : 0;
    const angle = sweep * share;
    if (angle <= 0.2) {
      startAngle += angle;
      return;
    }
    const endAngle = startAngle + angle;
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", describeArc(140, 140, radius, startAngle, endAngle));
    path.setAttribute("stroke", STATUS_META[status].color);
    path.setAttribute("class", "donut-segment");
    path.dataset.status = status;
    path.dataset.count = value;
    path.dataset.total = total;
    ui.donutGroup.appendChild(path);
    startAngle = endAngle;
  });

  bindDonutEvents();
  applyDonutSelection();
}

// Animate donut sweep.
function animateDonut(counts, total) {
  if (isStatic) {
    renderDonut(counts, total, 1);
    return;
  }
  const start = performance.now();
  const duration = 900;
  function tick(now) {
    const progress = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - progress, 3);
    renderDonut(counts, total, eased);
    if (progress < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

let tooltipTarget = null;
let tooltipRaf = null;
let tooltipPos = { x: 0, y: 0 };

// Donut hover + filter click.
function bindDonutEvents() {
  const segments = Array.from(ui.donutGroup.querySelectorAll(".donut-segment"));
  segments.forEach((segment) => {
    segment.addEventListener("mouseenter", () => {
      tooltipTarget = segment;
      updateTooltip();
      ui.tooltip.classList.remove("hidden");
    });
    segment.addEventListener("mousemove", (event) => {
      tooltipPos = { x: event.clientX, y: event.clientY };
      scheduleTooltip();
    });
    segment.addEventListener("mouseleave", () => {
      tooltipTarget = null;
      ui.tooltip.classList.add("hidden");
    });
    segment.addEventListener("click", () => {
      const status = segment.dataset.status;
      setFilter(state.filter === status ? "all" : status);
    });
  });
}

function scheduleTooltip() {
  if (tooltipRaf) return;
  tooltipRaf = requestAnimationFrame(() => {
    updateTooltip();
    tooltipRaf = null;
  });
}

function updateTooltip() {
  if (!tooltipTarget) return;
  const count = Number(tooltipTarget.dataset.count || 0);
  const total = Number(tooltipTarget.dataset.total || 0);
  const status = tooltipTarget.dataset.status;
  const percent = total ? (count / total) * 100 : 0;
  ui.tooltip.textContent = `${STATUS_META[status].label}: ${count} (${percent.toFixed(1)}%)`;
  ui.tooltip.style.left = `${tooltipPos.x}px`;
  ui.tooltip.style.top = `${tooltipPos.y - 12}px`;
}

function applyDonutSelection() {
  const segments = Array.from(ui.donutGroup.querySelectorAll(".donut-segment"));
  segments.forEach((segment) => {
    const status = segment.dataset.status;
    if (state.filter !== "all" && state.filter === status) {
      segment.classList.add("active");
    } else {
      segment.classList.remove("active");
    }
  });
}

// Apply status filter.
function setFilter(filter) {
  state.filter = filter;
  ui.filterButtons.forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.filter === filter);
  });
  applyDonutSelection();
  renderTable();
  updateCenterDisplay(filter);
}

// Apply search filter.
function setSearch(value) {
  state.search = value.toLowerCase();
  renderTable();
}

// Render suites list.
function renderSuites(suites) {
  if (!suites.length) {
    ui.suiteList.textContent = "No suites detected yet.";
    return;
  }
  ui.suiteList.innerHTML = "";
  suites.forEach((suite) => {
    const div = document.createElement("div");
    div.textContent = suite;
    ui.suiteList.appendChild(div);
  });
}

// --- AI insights (smart bug reporting) ---
// These helpers favor AI-provided metadata (e.g., from Mistral). Fallbacks stay heuristic.
function classifySeverity(duration, error = "", aiSeverity = "") {
  if (aiSeverity) return aiSeverity.toLowerCase();
  const d = Number(duration || 0);
  const text = (error || "").toLowerCase();
  if (text.includes("crash") || text.includes("exception") || text.includes("fatal") || d > 15000) return "critical";
  if (text.includes("timeout") || text.includes("failed") || d > 8000) return "major";
  return "medium";
}

function priorityFor(severity, aiPriority = "") {
  if (aiPriority) return aiPriority;
  if (severity === "critical") return "P0 Blocker";
  if (severity === "major") return "P1 High";
  return "P2 Medium";
}

function impactText(severity, aiImpact = "") {
  if (aiImpact) return aiImpact;
  if (severity === "critical") return "High user-visible impact";
  if (severity === "major") return "Functionality impaired";
  return "Localized impact";
}

function tagsFor(test, severity) {
  if (Array.isArray(test.aiTags) && test.aiTags.length) return test.aiTags;
  const tags = [];
  const label = severity === "critical" ? "Needs hotfix" : severity === "major" ? "Fix this sprint" : "Monitor";
  tags.push(label);
  if (Array.isArray(test.tags)) {
    tags.push(...test.tags.slice(0, 3));
  }
  if (test.duration > 10000) tags.push("Long-running");
  if (test.errorMessage && /timeout|wait/i.test(test.errorMessage)) tags.push("Timeout");
  return tags;
}

// --- JIRA-STYLE MODAL RENDERING ---

function renderInsights(tests) {
  // Grab containers
  const containers = {
    runId: document.getElementById("jira-run-id"),
    timestamp: document.getElementById("jira-timestamp"),
    statusBadge: document.getElementById("jira-status-badge"),
    health: document.getElementById("jira-health-content"),
    priorityBody: document.getElementById("jira-priority-body"),
    bugList: document.getElementById("jira-bug-list"),
    recs: document.getElementById("jira-recs-content")
  };

  if (!containers.health) return; // Guard if modal structure missing

  // 1. Process Data
  const failed = (tests || []).filter((t) => t.status === "failed");
  const total = tests?.length || 0;
  const passCount = tests?.filter(t => t.status === 'passed').length || 0;
  const passRate = total ? (passCount / total) * 100 : 0;
  const criticalCount = failed.filter(t => t.aiSeverity === 'critical' || classifySeverity(t.duration, t.errorMessage) === 'critical').length;

  // 2. Hydrate Header Metadata
  const runId = `RUN-${Math.floor(Date.now() / 1000).toString(16).toUpperCase().slice(-6)}`;
  const modelUsed = failed[0]?.aiModel || "AI Model detected";
  containers.runId.textContent = runId;
  containers.timestamp.textContent = new Date().toLocaleTimeString();

  // Inject Model Badge into Header if not present
  let modelBadge = document.getElementById("jira-model-badge");
  if (!modelBadge) {
    modelBadge = document.createElement("span");
    modelBadge.id = "jira-model-badge";
    modelBadge.className = "jira-badge status-badge stable";
    modelBadge.style.fontSize = "10px";
    modelBadge.style.marginLeft = "12px";
    document.querySelector(".jira-title-block").appendChild(modelBadge);
  }
  modelBadge.textContent = modelUsed;

  // 3. Determine Product Status
  let healthStatus = "Unstable";
  let healthClass = "unstable";
  let justification = "High failure rate detected.";

  if (passRate >= 98 && criticalCount === 0) {
    healthStatus = "Healthy";
    healthClass = "healthy";
    justification = "High pass rate with no critical issues.";
  } else if (passRate >= 90) {
    healthStatus = "Mostly Stable";
    healthClass = "stable";
    justification = "acceptable pass rate, minor issues only.";
  } else if (passRate >= 80 && criticalCount <= 1) {
    healthStatus = "At Risk";
    healthClass = "risk";
    justification = "Pass rate degrading, monitoring recommended.";
  } else if (criticalCount >= 5 || passRate < 50) {
    healthStatus = "Critical - Release Blocked";
    healthClass = "critical";
    justification = "Too many critical failures or low pass rate.";
  }

  containers.statusBadge.textContent = healthStatus;
  containers.statusBadge.className = `jira-badge status-badge ${healthClass}`;

  // 4. Render Health Section
  containers.health.innerHTML = `
    <div class="health-metric">
      <span class="health-label">Pass Rate</span>
      <span class="health-value" style="color: ${passRate > 90 ? '#006644' : '#DE350B'}">${passRate.toFixed(1)}%</span>
    </div>
    <div class="health-metric">
      <span class="health-label">Total Tests</span>
      <span class="health-value">${total}</span>
    </div>
    <div class="health-metric">
      <span class="health-label">Failures</span>
      <span class="health-value" style="color: #DE350B">${failed.length}</span>
    </div>
    <div class="health-metric">
      <span class="health-label">Critical Flags</span>
      <span class="health-value">${criticalCount}</span>
    </div>
    <div class="health-justification">
      AI Assessment: ${justification}
    </div>
  `;

  // 5. Render Priority Table & Bug Cards
  containers.priorityBody.innerHTML = "";
  containers.bugList.innerHTML = "";

  if (failed.length === 0) {
    containers.bugList.innerHTML = `<div style="padding:20px; text-align:center; color:#6B778C;">No failures detected. Great job!</div>`;
    return;
  }

  // Sort: Critical -> High -> Medium -> Low
  const severityOrder = { critical: 0, high: 1, major: 1, medium: 2, low: 3 };
  const sortedFailures = [...failed].sort((a, b) => {
    const sevA = classifySeverity(a.duration, a.errorMessage, a.aiSeverity);
    const sevB = classifySeverity(b.duration, b.errorMessage, b.aiSeverity);
    return (severityOrder[sevA] ?? 2) - (severityOrder[sevB] ?? 2);
  });

  // Helper to escape HTML tags in error messages (prevents '<h1>' in error text from rendering as a giant heading)
  const escapeHtml = (str) => {
    return (str || "").replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  };

  sortedFailures.forEach((test, idx) => {
    const sev = classifySeverity(test.duration, test.errorMessage, test.aiSeverity);
    const textSev = sev === 'major' ? 'High' : sev.charAt(0).toUpperCase() + sev.slice(1);
    const moduleName = test.suite || "Core";
    const confidence = test.aiConfidence ? (test.aiConfidence > 0.8 ? "High" : "Medium") : "Medium";

    // Table Row
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><span class="jira-badge priority-badge ${sev}">${textSev}</span></td>
      <td>${moduleName}</td>
      <td title="${test.title}" style="max-width: 250px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${test.title}</td>
      <td>${confidence}</td>
    `;
    containers.priorityBody.appendChild(tr);

    // Bug Card (Collapsible)
    const card = document.createElement("div");
    card.className = "jira-bug-card";

    // Clean and escape the error message
    let rawErr = (test.errorMessage || "").replace(/AssertionError: /i, "");
    const cleanErr = escapeHtml(rawErr);

    card.innerHTML = `
      <details ${idx === 0 ? "open" : ""}>
        <summary class="bug-summary">
          <div class="bug-title-row">
            <span class="jira-badge priority-badge ${sev}">${textSev}</span>
            <span>${test.title}</span>
          </div>
          <span style="font-size:12px; color:#6B778C;">${test.suite || "Core"}</span>
        </summary>
        <div class="bug-details">
          <div class="bug-field">
             <span class="field-label">Summary</span>
             <span class="field-value"><strong>${test.title}</strong><br/>${test.aiSummary}</span>
          </div>
          <div class="bug-field">
             <span class="field-label">Error Translation</span>
             <span class="field-value">${test.aiHumanError || "N/A"}</span>
          </div>
          <div class="bug-field">
             <span class="field-label">Test Root Cause</span>
             <span class="field-value">${test.aiTestRootCause || "N/A"}</span>
          </div>
          <div class="bug-field">
             <span class="field-label">Product Root Cause</span>
             <span class="field-value">${test.aiProductRootCause || "N/A"}</span>
          </div>
          <div class="bug-field">
             <span class="field-label">Impact</span>
             <span class="field-value">${test.aiImpact}</span>
          </div>
          <div class="bug-field">
             <span class="field-label">Expected Result</span>
             <span class="field-value" style="color:#006644;">${test.aiExpected}</span>
          </div>
          <div class="bug-field">
             <span class="field-label">Actual Result</span>
             <span class="field-value" style="color:#DE350B; font-family:monospace; font-size: 13px;">${cleanErr}</span>
          </div>
          <div class="bug-field">
             <span class="field-label">AI Analysis <span style="font-size:10px; color:#a99bff; margin-left:4px;">(${test.aiModel})</span></span>
             <span class="field-value" style="font-weight:600; color:#403294;">${test.aiFix}</span>
          </div>
           <div class="bug-field">
             <span class="field-label">Evidence</span>
             <span class="field-value">${test.screenshot ? `
               <div class="screenshot-preview" onclick="window.open('${test.screenshot}', '_blank')">
                 <img src="${test.screenshot}" alt="Failure Screenshot" style="max-width: 100%; border-radius: 4px; cursor: zoom-in; border: 1px solid #dfe1e6;" />
                 <div style="font-size: 11px; color: #6b778c; margin-top: 4px;">Click to enlarge</div>
               </div>
             ` : "None"}</span>
          </div>
        </div>
      </details>
    `;
    containers.bugList.appendChild(card);
  });

  // 6. Global Recommendations
  let recsHTML = "";
  if (healthClass === "critical") {
    recsHTML += `<div class="rec-item"><span class="rec-label" style="color:#BF2600">IMMEDIATE:</span> Block deployment. Review ${criticalCount} critical failures.</div>`;
  }
  if (healthClass === "risk") {
    recsHTML += `<div class="rec-item"><span class="rec-label" style="color:#FF8B00">WARNING:</span> Flakiness detected. stabilize tests before next run.</div>`;
  }
  recsHTML += `<div class="rec-item"><span class="rec-label">Action:</span> Assign top 3 failures to engineering triage.</div>`;

  containers.recs.innerHTML = recsHTML;
}

// Render trend tiles + runtime pill.
function renderMetrics(stats) {
  lastMetricsStats = stats;
  renderTrendTiles(stats);
  renderSpeedChart(stats);
}

// Draw per-metric trend tiles from current report data.
function renderTrendTiles(stats) {
  const tests = state.tests || [];
  const totalTests = stats.testsRegistered || stats.tests || tests.length || 1;
  const meanDuration = totalTests ? (stats.duration || 0) / totalTests : 1;
  const safeMean = meanDuration || 1;
  const labels = tests.length ? tests.map((_, idx) => idx + 1) : [];
  const durations = tests.length ? tests.map((t) => Number(t.duration || 0)) : [];

  if (ui.trend.testsValue) {
    ui.trend.testsValue.textContent = totalTests.toLocaleString();
  }
  if (ui.trend.passRateValue) {
    ui.trend.passRateValue.textContent = `${Number(stats.passPercent || 0).toFixed(1)}%`;
  }
  if (ui.trend.failValue) {
    ui.trend.failValue.textContent = Number(stats.failures || 0).toLocaleString();
  }
  if (ui.trend.runtimeValue) {
    const runtimeMinutes = (stats.duration || 0) / 1000 / 60;
    ui.trend.runtimeValue.textContent = `${runtimeMinutes.toFixed(1)}m`;
  }

  const runtimeNorm = durations.map((d) => Math.max(-1.2, Math.min(1.2, (d - safeMean) / safeMean)));
  const passSeries = tests.map((t) =>
    t.status === "passed" ? Math.max(-1.2, Math.min(1.2, (t.duration - safeMean) / safeMean)) : 0
  );
  const failSeries = tests.map((t) =>
    t.status === "failed" ? Math.max(-1.2, Math.min(1.2, (t.duration - safeMean) / safeMean)) : 0
  );
  const overallRate = totalTests ? (stats.passes || 0) / totalTests : 0;
  const passRateSeries = tests.map((_, idx) => {
    const slice = tests.slice(0, idx + 1);
    const rate = slice.length ? slice.filter((t) => t.status === "passed").length / slice.length : 0;
    const delta = rate - overallRate;
    return Math.max(-0.8, Math.min(0.8, delta / (overallRate || 1 || 0.0001)));
  });

  drawTrendMulti(
    ui.trend.tests,
    labels,
    [
      { values: passSeries, color: "#2FCF86" },
      { values: failSeries, color: "#E84B5C" },
    ]
  );
  drawTrend(ui.trend.passRate, labels, passRateSeries, "#2FCF86");
  drawTrend(ui.trend.fail, labels, failSeries, "#E84B5C");
  drawTrend(ui.trend.runtime, labels, runtimeNorm, "#69b8ff");
}

// Draw overlapping sparklines in a single canvas (used for Total Tests).
function drawTrendMulti(canvas, labels, series) {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(280, Math.round(rect.width || 0) || 320);
  const height = Math.max(110, Math.round(rect.height || 0) || 120);
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.scale(dpr, dpr);

  ctx.clearRect(0, 0, width, height);
  const padX = 10;
  const padY = 10;
  const plotW = width - padX * 2;
  const plotH = height - padY * 2;
  const midY = padY + plotH / 2;
  const isDark = document.body.dataset.theme === "dark";
  const gridColor = isDark ? "rgba(255,255,255,0.28)" : "rgba(34,24,62,0.22)";
  const axisColor = isDark ? "rgba(255,255,255,0.4)" : "rgba(34,24,62,0.32)";

  if (!labels.length) {
    labels = Array.from({ length: 6 }, (_, idx) => idx + 1);
    series = series.map((s, idx) => ({
      ...s,
      values: labels.map((_, j) => 0.6 * Math.sin(j / 1.5 + idx * 0.6)),
    }));
  }

  const step = labels.length > 1 ? plotW / (labels.length - 1) : plotW;
  const amplitude = plotH * 0.45;
  const allValues = series.flatMap((s) => s.values || []);
  const maxAbs = Math.max(0.2, ...allValues.map((v) => Math.abs(v || 0)));

  // Grid lines (horizontal + sparse verticals) for stronger plotted feel.
  ctx.strokeStyle = gridColor;
  ctx.lineWidth = 1;
  const horizontalLines = 4;
  for (let i = 0; i <= horizontalLines; i += 1) {
    const y = padY + (plotH / horizontalLines) * i;
    ctx.beginPath();
    ctx.moveTo(padX, y);
    ctx.lineTo(padX + plotW, y);
    ctx.stroke();
  }
  const verticalEvery = Math.max(1, Math.floor(labels.length / 5));
  for (let i = 0; i < labels.length; i += verticalEvery) {
    const x = padX + step * i;
    ctx.beginPath();
    ctx.moveTo(x, padY);
    ctx.lineTo(x, padY + plotH);
    ctx.stroke();
  }

  ctx.strokeStyle = axisColor;
  ctx.beginPath();
  ctx.moveTo(padX, midY);
  ctx.lineTo(padX + plotW, midY);
  ctx.stroke();

  series.forEach((item) => {
    const values = item.values || [];
    let points = values.map((v, i) => {
      const x = padX + step * i;
      const y = midY - ((v || 0) / maxAbs) * amplitude;
      return { x, y };
    });

    // Handle single-point series by duplicating point to draw a visible line
    if (points.length === 1) {
      points = [
        { x: padX, y: points[0].y },
        { x: padX + plotW, y: points[0].y }
      ];
    }

    if (points.length < 2) return;

    const gradient = ctx.createLinearGradient(0, padY, 0, padY + plotH);
    gradient.addColorStop(0, `${item.color}30`);
    gradient.addColorStop(1, `${item.color}05`);
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i += 1) {
      const prev = points[i - 1];
      const curr = points[i];
      const midX = (prev.x + curr.x) / 2;
      const midY2 = (prev.y + curr.y) / 2;
      ctx.quadraticCurveTo(prev.x, prev.y, midX, midY2);
    }
    ctx.lineTo(points[points.length - 1].x, midY + amplitude);
    ctx.lineTo(points[0].x, midY + amplitude);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = item.color;
    ctx.lineWidth = 1.2;
    ctx.lineJoin = "miter";
    ctx.lineCap = "butt";
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i += 1) {
      const prev = points[i - 1];
      const curr = points[i];
      const midX = (prev.x + curr.x) / 2;
      const midY2 = (prev.y + curr.y) / 2;
      ctx.quadraticCurveTo(prev.x, prev.y, midX, midY2);
    }
    ctx.lineTo(points[points.length - 1].x, points[points.length - 1].y);
    ctx.stroke();
  });
}

// Speed bar chart: fast/medium/slow with durations and tags.
function renderSpeedChart() {
  const canvas = ui.speedChart;
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const speedWrap = canvas.closest(".speed-wrap");
  const isDark = document.body.dataset.theme === "dark";

  // Exclude failed tests; sort by duration ascending so fastest is tallest.
  // Exclude failed tests; sort by duration ascending so fastest is tallest.
  const tests = (state.tests || []).filter((t) => t.status === "passed");
  const dpr = window.devicePixelRatio || 1;
  const width = speedWrap ? speedWrap.clientWidth : 360;
  const height = 220;
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  canvas.height = height * dpr;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, width, height);

  if (!tests.length) {
    if (speedWrap) speedWrap.classList.add("empty");
    ctx.fillStyle = document.body.dataset.theme === "dark" ? "rgba(244,241,255,0.72)" : "rgba(34,24,62,0.65)";
    ctx.font = "13px Segoe UI, sans-serif";
    ctx.fillText("Upload a report to see per-test speed analysis.", 12, height / 2);
    return;
  }
  if (speedWrap) speedWrap.classList.remove("empty");

  const durations = tests.map((t) => Number(t.duration || 0));
  const mean = durations.reduce((a, b) => a + b, 0) / durations.length || 1;
  const max = Math.max(...durations, mean);
  const slowest = Math.max(...durations);

  const colorFor = (value) => {
    const ratio = value / mean;
    if (ratio <= 0.85) return { base: "#7f6bff", glow: "rgba(127,107,255,0.32)" }; // fast violet
    if (ratio <= 1.15) return { base: "#b5a8ff", glow: "rgba(181,168,255,0.26)" }; // medium lilac
    return { base: "#d8d6e5", glow: "rgba(140,132,170,0.2)" }; // slow neutral with soft red hint removed
  };

  const padX = 12;
  const padY = 14;
  const plotW = width - padX * 2;
  const plotH = height - padY * 2 - 18;
  const barGap = 10;
  const barCount = Math.min(tests.length, Math.floor(plotW / 30));
  const step = plotW / Math.max(1, barCount);
  const barWidth = step - barGap;
  const gridColor = document.body.dataset.theme === "dark" ? "rgba(255,255,255,0.08)" : "rgba(34,24,62,0.15)";

  const indices = Array.from({ length: tests.length }, (_, i) => i);
  const sample = tests.length > barCount ? indices.slice(0, barCount) : indices;

  ctx.strokeStyle = gridColor;
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i += 1) {
    const y = padY + (plotH / 4) * i;
    ctx.beginPath();
    ctx.moveTo(padX, y);
    ctx.lineTo(padX + plotW, y);
    ctx.stroke();
  }

  ctx.font = "11px Segoe UI, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";

  sample
    .sort((a, b) => (tests[a].duration || 0) - (tests[b].duration || 0))
    .forEach((idx, i) => {
      const test = tests[idx];
      const dur = Number(test.duration || 0);
      // Invert so fastest is tallest
      const barHeight = Math.max(8, ((max - dur) / max) * plotH);
      const x = padX + step * i + barGap / 2;
      const y = padY + plotH - barHeight;
      const color = colorFor(dur);

      // bar
      const gradient = ctx.createLinearGradient(0, y, 0, y + barHeight);
      gradient.addColorStop(0, `${color.base}e6`);
      gradient.addColorStop(1, `${color.base}66`);
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + barWidth, y);
      ctx.arcTo(x + barWidth + 4, y, x + barWidth + 4, y + 6, 6);
      ctx.lineTo(x + barWidth + 4, y + barHeight - 6);
      ctx.arcTo(x + barWidth + 4, y + barHeight, x + barWidth, y + barHeight, 6);
      ctx.lineTo(x, y + barHeight);
      ctx.arcTo(x - 4, y + barHeight, x - 4, y + barHeight - 6, 6);
      ctx.lineTo(x - 4, y + 6);
      ctx.arcTo(x - 4, y, x, y, 6);
      ctx.closePath();
      ctx.fill();

      ctx.shadowColor = color.glow;
      ctx.shadowBlur = 12;
      ctx.fill();
      ctx.shadowBlur = 0;

      // duration label
      // duration label only for fastest bar
      if (i === 0) {
        ctx.fillStyle = isDark ? "#fff" : "rgba(34,24,62,0.82)";
        ctx.font = "12px Segoe UI, sans-serif";
        const durLabel = `${Math.round(dur)} ms`;
        ctx.fillText(durLabel, x + barWidth / 2, y - 6);
      }

      // tag label under bar (first tag or fallback)
      ctx.fillStyle = "rgba(244,241,255,0.8)";
      ctx.textBaseline = "top";
      // no bottom labels to reduce clutter
    });

  // Update fastest/slowest text notes
  if (ui.speedFastest) {
    const fastestIdx = sample.sort((a, b) => (tests[a].duration || 0) - (tests[b].duration || 0))[0];
    if (fastestIdx !== undefined) {
      const fastest = tests[fastestIdx];
      ui.speedFastest.textContent = `Fastest: ${Math.round(fastest.duration || 0)} ms — ${fastest.title || "Untitled"}`;
    }
  }
  if (ui.speedSlowest) {
    const slowestIdx = sample.sort((a, b) => (tests[b].duration || 0) - (tests[a].duration || 0))[0];
    if (slowestIdx !== undefined) {
      const slowestTest = tests[slowestIdx];
      ui.speedSlowest.textContent = `Slowest: ${Math.round(slowestTest.duration || 0)} ms — ${slowestTest.title || "Untitled"}`;
    }
  }
}

// Draw a single sparkline trend into a canvas.
function drawTrend(canvas, labels, values, color) {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(280, Math.round(rect.width || 0) || 320);
  const height = Math.max(110, Math.round(rect.height || 0) || 120);
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.scale(dpr, dpr);

  ctx.clearRect(0, 0, width, height);
  const padX = 10;
  const padY = 10;
  const plotW = width - padX * 2;
  const plotH = height - padY * 2;
  const midY = padY + plotH / 2;
  const isDark = document.body.dataset.theme === "dark";
  const gridColor = isDark ? "rgba(255,255,255,0.28)" : "rgba(34,24,62,0.2)";
  const axisColor = isDark ? "rgba(255,255,255,0.4)" : "rgba(34,24,62,0.28)";
  if (!labels.length) {
    labels = Array.from({ length: 6 }, (_, idx) => idx + 1);
    values = labels.map((_, idx) => 0.6 * Math.sin(idx / 1.5));
  }
  const step = labels.length > 1 ? plotW / (labels.length - 1) : plotW;
  const amplitude = plotH * 0.45;
  const maxAbs = Math.max(0.2, ...values.map((v) => Math.abs(v || 0)));

  ctx.strokeStyle = gridColor;
  ctx.lineWidth = 1;
  const horizontalLines = 4;
  for (let i = 0; i <= horizontalLines; i += 1) {
    const y = padY + (plotH / horizontalLines) * i;
    ctx.beginPath();
    ctx.moveTo(padX, y);
    ctx.lineTo(padX + plotW, y);
    ctx.stroke();
  }
  const verticalEvery = Math.max(1, Math.floor(labels.length / 5));
  for (let i = 0; i < labels.length; i += verticalEvery) {
    const x = padX + step * i;
    ctx.beginPath();
    ctx.moveTo(x, padY);
    ctx.lineTo(x, padY + plotH);
    ctx.stroke();
  }

  ctx.strokeStyle = axisColor;
  ctx.beginPath();
  ctx.moveTo(padX, midY);
  ctx.lineTo(padX + plotW, midY);
  ctx.stroke();

  let points = values.length
    ? values.map((v, i) => {
      const x = padX + step * i;
      const y = midY - ((v || 0) / maxAbs) * amplitude;
      return { x, y };
    })
    : [];

  // Handle single-point series by drawing a flat line across the plot
  if (points.length === 1) {
    points = [
      { x: padX, y: points[0].y },
      { x: padX + plotW, y: points[0].y }
    ];
  }

  if (points.length < 2) return;

  const gradient = ctx.createLinearGradient(0, padY, 0, padY + plotH);
  gradient.addColorStop(0, `${color}30`);
  gradient.addColorStop(1, `${color}06`);
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i += 1) {
    const prev = points[i - 1];
    const curr = points[i];
    const midX = (prev.x + curr.x) / 2;
    const midY2 = (prev.y + curr.y) / 2;
    ctx.quadraticCurveTo(prev.x, prev.y, midX, midY2);
  }
  ctx.lineTo(points[points.length - 1].x, midY + amplitude);
  ctx.lineTo(points[0].x, midY + amplitude);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = color;
  ctx.lineWidth = 1.2;
  ctx.lineJoin = "miter";
  ctx.lineCap = "butt";
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i += 1) {
    const prev = points[i - 1];
    const curr = points[i];
    const midX = (prev.x + curr.x) / 2;
    const midY2 = (prev.y + curr.y) / 2;
    ctx.quadraticCurveTo(prev.x, prev.y, midX, midY2);
  }
  ctx.lineTo(points[points.length - 1].x, points[points.length - 1].y);
  ctx.stroke();
}

function renderMetricsCanvas(payload) {
  const canvas = ui.metricsChart;
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const { labels, runtimeNorm, passWave, failWave } = payload;
  const dpr = window.devicePixelRatio || 1;
  const width = 520;
  const height = 300;
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.scale(dpr, dpr);

  const padX = 32;
  const padTop = 18;
  const padBottom = 28;
  const plotW = width - padX * 2;
  const plotH = height - padTop - padBottom;
  const midY = padTop + plotH / 2;
  const step = labels.length > 1 ? plotW / (labels.length - 1) : plotW;

  ctx.clearRect(0, 0, width, height);

  const isDark = document.body.dataset.theme === "dark";
  const gridColor = isDark ? "rgba(255,255,255,0.08)" : "rgba(34,24,62,0.08)";
  const baselineColor = isDark ? "rgba(255,255,255,0.22)" : "rgba(34,24,62,0.22)";
  const runtimeColor = isDark ? "#7cc3ff" : "#3b4ad8";
  const passColor = isDark ? "#36d38b" : "#1b8b58";
  const failColor = "#e84b5c";

  // Grid
  ctx.strokeStyle = gridColor;
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i += 1) {
    const y = padTop + (plotH / 4) * i;
    ctx.beginPath();
    ctx.moveTo(padX, y);
    ctx.lineTo(padX + plotW, y);
    ctx.stroke();
  }

  // Baseline
  ctx.strokeStyle = baselineColor;
  ctx.beginPath();
  ctx.moveTo(padX, midY);
  ctx.lineTo(padX + plotW, midY);
  ctx.stroke();

  const amplitude = plotH * 0.45;
  const maxAbs = Math.max(
    0.3,
    ...runtimeNorm.map((v) => Math.abs(v)),
    ...passWave.map((v) => Math.abs(v || 0)),
    ...failWave.map((v) => Math.abs(v || 0))
  );
  const scale = 1 / maxAbs;
  const toPoints = (series) =>
    series.map((v, i) => {
      const value = (v ?? 0) * scale;
      const x = padX + step * i;
      const y = midY - value * amplitude;
      return { x, y };
    });

  const drawSmoothLine = (points, color) => {
    if (points.length < 2) return;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.6;
    ctx.lineJoin = "miter";
    ctx.lineCap = "butt";
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i += 1) {
      const prev = points[i - 1];
      const curr = points[i];
      const midX = (prev.x + curr.x) / 2;
      const midY = (prev.y + curr.y) / 2;
      ctx.quadraticCurveTo(prev.x, prev.y, midX, midY);
    }
    ctx.lineTo(points[points.length - 1].x, points[points.length - 1].y);
    ctx.stroke();
  };

  const runtimePoints = toPoints(runtimeNorm);
  const passPoints = toPoints(passWave.map((v) => (v === null ? 0 : v)));
  const failPoints = toPoints(failWave.map((v) => (v === null ? 0 : v)));

  if (runtimePoints.length >= 2) {
    const gradient = ctx.createLinearGradient(0, padTop, 0, padTop + plotH);
    gradient.addColorStop(0, isDark ? "rgba(124,195,255,0.22)" : "rgba(59,74,216,0.14)");
    gradient.addColorStop(1, "rgba(59,74,216,0.01)");
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.moveTo(runtimePoints[0].x, runtimePoints[0].y);
    for (let i = 1; i < runtimePoints.length; i += 1) {
      const prev = runtimePoints[i - 1];
      const curr = runtimePoints[i];
      const midX = (prev.x + curr.x) / 2;
      const midY = (prev.y + curr.y) / 2;
      ctx.quadraticCurveTo(prev.x, prev.y, midX, midY);
    }
    ctx.lineTo(runtimePoints[runtimePoints.length - 1].x, midY + amplitude);
    ctx.lineTo(runtimePoints[0].x, midY + amplitude);
    ctx.closePath();
    ctx.fill();
  }

  drawSmoothLine(runtimePoints, runtimeColor);
  drawSmoothLine(passPoints, passColor);
  drawSmoothLine(failPoints, failColor);

  ctx.fillStyle = isDark ? "rgba(255,255,255,0.5)" : "rgba(34,24,62,0.5)";
  ctx.font = "11px Segoe UI, sans-serif";
  ctx.fillText("Mean runtime", padX, midY - 8);

  if (!labels.length) {
    ctx.fillStyle = isDark ? "rgba(255,255,255,0.6)" : "rgba(34,24,62,0.6)";
    ctx.font = "12px Segoe UI, sans-serif";
    ctx.fillText("No test data to plot", padX, midY);
  }
}

// Update donut center labels based on filter.
function updateCenterDisplay(filter) {
  const stats = state.stats;
  if (!stats) return;
  ui.totalTests.classList.remove("pass", "fail", "skipped", "pending");

  if (filter === "all") {
    ui.centerLabel.textContent = "Total Tests";
    ui.totalTests.textContent = stats.tests.toLocaleString();
    ui.centerSub.textContent = "Tap a segment to filter";
    return;
  }

  const keyMap = {
    passed: "passes",
    failed: "failures",
    skipped: "skipped",
    pending: "pending",
  };
  const key = keyMap[filter] || filter;
  const count = stats[key] || 0;
  ui.centerLabel.textContent = `${STATUS_META[filter].label} Tests`;
  ui.totalTests.textContent = count.toLocaleString();
  ui.totalTests.classList.add(filter === "failed" ? "fail" : filter);
  ui.centerSub.textContent = "Click again to clear filter";
}

// Render top status chip + timestamp.
function renderHeader(stats) {
  const hasFailures = stats.failures > 0;
  ui.statusChip.textContent = hasFailures ? `${stats.failures} FAILING` : "ALL PASSED";
  ui.statusChip.classList.toggle("ok", !hasFailures);
  ui.statusChip.classList.toggle("bad", hasFailures);
  setLastUpdated();
}

// Compute filtered + sorted test list for the table.
function getFilteredTests() {
  let filtered = [...state.tests];
  if (state.filter !== "all") {
    filtered = filtered.filter((test) => test.status === state.filter);
  }
  if (state.search) {
    filtered = filtered.filter((test) => {
      const text = `${test.title} ${test.tags.join(" ")}`.toLowerCase();
      return text.includes(state.search);
    });
  }

  const order = { failed: 0, passed: 1, skipped: 2, pending: 3 };
  filtered.sort((a, b) => {
    const statusDiff = (order[a.status] ?? 9) - (order[b.status] ?? 9);
    if (statusDiff !== 0) return statusDiff;
    return (b.duration || 0) - (a.duration || 0);
  });

  return filtered;
}

// Render tests table.
function renderTable() {
  const tests = getFilteredTests();
  ui.testsBody.innerHTML = "";
  if (!tests.length) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 4;
    cell.textContent = "No tests match the current filters.";
    row.appendChild(cell);
    ui.testsBody.appendChild(row);
    return;
  }

  tests.forEach((test) => {
    const row = document.createElement("tr");
    row.className = `row-${test.status}`;
    row.dataset.severity = test.aiSeverity || "";
    row.dataset.priority = test.aiPriority || "";
    row.dataset.impact = test.aiImpact || "";

    const statusCell = document.createElement("td");
    const statusWrap = document.createElement("span");
    const statusClassMap = {
      passed: "status-pass",
      failed: "status-fail",
      skipped: "status-skipped",
      pending: "status-pending",
    };
    statusWrap.className = `status-pill ${statusClassMap[test.status] || ""}`.trim();
    const statusDot = document.createElement("span");
    statusDot.className = "status-dot";
    statusWrap.appendChild(statusDot);
    statusWrap.appendChild(
      document.createTextNode(STATUS_META[test.status]?.label || test.status.toUpperCase())
    );
    statusCell.appendChild(statusWrap);

    const titleCell = document.createElement("td");
    titleCell.textContent = test.title;
    titleCell.className = "title-cell";

    const tagsCell = document.createElement("td");
    const tagWrap = document.createElement("div");
    tagWrap.className = "tag-list";
    if (test.tags.length) {
      test.tags.forEach((tag) => {
        const span = document.createElement("span");
        span.className = "tag";
        span.textContent = tag;
        tagWrap.appendChild(span);
      });
    } else {
      const span = document.createElement("span");
      span.textContent = "-";
      tagWrap.appendChild(span);
    }
    tagsCell.appendChild(tagWrap);

    const durationCell = document.createElement("td");
    const seconds = (test.duration / 1000).toFixed(1);
    durationCell.textContent = `${test.duration} ms (${seconds}s)`;

    row.appendChild(statusCell);
    row.appendChild(titleCell);
    row.appendChild(tagsCell);
    row.appendChild(durationCell);

    ui.testsBody.appendChild(row);

    const hasDetails = test.status === "failed" && (test.errorMessage || test.screenshot);
    if (hasDetails) {
      row.classList.add("row-clickable");
      const detailRow = document.createElement("tr");
      detailRow.className = "details-row hidden";
      const detailCell = document.createElement("td");
      detailCell.colSpan = 4;
      const panel = document.createElement("div");
      panel.className = "detail-panel";
      if (test.errorMessage) {
        const errorText = document.createElement("div");
        errorText.className = "error-text";
        errorText.textContent = test.errorMessage;
        panel.appendChild(errorText);
      }
      if (test.screenshot) {
        const actions = document.createElement("div");
        actions.className = "detail-actions";
        const link = document.createElement("a");
        link.href = test.screenshot;
        link.textContent = "Open screenshot";
        link.target = "_blank";
        link.rel = "noopener";
        actions.appendChild(link);
        panel.appendChild(actions);
      }
      detailCell.appendChild(panel);
      detailRow.appendChild(detailCell);
      ui.testsBody.appendChild(detailRow);
      row.addEventListener("click", () => {
        detailRow.classList.toggle("hidden");
      });
    }
  });
}

// Update source input field with current report path.
function updateSourceInput(url) {
  ui.sourceInput.value = url;
}

// Offline mode: only file upload works.
function loadReport(overrideUrl = "") {
  if (overrideUrl) {
    fetchReport(overrideUrl);
    return;
  }
  fetchReport(REPORT_JSON_PATH, true);
}

// Apply loaded report to UI state and render.
function handleReport(report, sourceUrl) {
  const { tests, suites } = collectTests(report);
  const stats = computeStats(report.stats || {}, tests);
  const signature = buildSignature(stats, tests);
  if (state.reportSignature === signature && state.reportUrl === sourceUrl) {
    setLastUpdated();
    renderMetrics(stats);
    return;
  }
  state.reportData = report;
  state.reportUrl = sourceUrl;
  state.tests = tests;
  state.suites = suites;
  state.reportSignature = signature;
  state.stats = stats;
  state.search = "";
  ui.searchInput.value = "";

  renderHeader(stats);
  renderMetrics(stats);
  renderSuites(suites);
  animateDonut(
    {
      passed: stats.passes,
      failed: stats.failures,
      skipped: stats.skipped,
      pending: stats.pending,
    },
    stats.tests
  );
  updateSourceInput(sourceUrl);
  setFilter("all");
  updateCenterDisplay("all");
  renderInsights(tests);
  if (ui.app) ui.app.classList.add("loaded");
}

// Download the currently loaded JSON report (if present).
function handleDownload() {
  if (!state.reportUrl) return;
  fetch(state.reportUrl, { cache: "no-store" })
    .then((res) => res.blob())
    .then((blob) => {
      const a = document.createElement("a");
      const filename = state.reportUrl.split("/").pop() || "results.json";
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      a.click();
      URL.revokeObjectURL(a.href);
    })
    .catch(() => { });
}

if (ui.filterButtons.length) {
  ui.filterButtons.forEach((btn) => {
    btn.addEventListener("click", () => setFilter(btn.dataset.filter));
  });
}

if (ui.searchInput) {
  ui.searchInput.addEventListener("input", (event) => setSearch(event.target.value));
}

if (ui.loadBtn) {
  ui.loadBtn.addEventListener("click", () => {
    const value = ui.sourceInput ? ui.sourceInput.value.trim() : "";
    loadReport(value);
  });
}

if (ui.refreshBtn) {
  ui.refreshBtn.addEventListener("click", () => {
    window.location.reload();
  });
}

if (ui.downloadBtn) {
  ui.downloadBtn.addEventListener("click", handleDownload);
}
if (ui.themeToggle) {
  ui.themeToggle.addEventListener("click", () => {
    const next = document.body.dataset.theme === "dark" ? "light" : "dark";
    applyTheme(next);
    localStorage.setItem("theme", next);
  });
}
if (ui.navOpen) {
  ui.navOpen.addEventListener("click", () => {
    document.body.classList.add("nav-open");
  });
}
if (ui.navClose) {
  ui.navClose.addEventListener("click", () => {
    document.body.classList.remove("nav-open");
  });
}
if (ui.navOverlay) {
  ui.navOverlay.addEventListener("click", () => {
    document.body.classList.remove("nav-open");
  });
}

function openInsights() {
  if (!ui.insightsModal) return;
  renderInsights(state.tests);
  ui.insightsModal.classList.remove("hidden");
}

function closeInsights() {
  if (!ui.insightsModal) return;
  ui.insightsModal.classList.add("hidden");
}

if (ui.insightsBtn) {
  ui.insightsBtn.addEventListener("click", openInsights);
}
if (ui.insightsClose) {
  ui.insightsClose.addEventListener("click", closeInsights);
}
if (ui.insightsModal) {
  ui.insightsModal.addEventListener("click", (event) => {
    if (event.target.classList.contains("modal-backdrop")) closeInsights();
  });
}
if (ui.fileInput) {
  ui.fileInput.addEventListener("change", (event) => {
    const file = event.target.files && event.target.files[0];
    if (file) {
      state.autoMode = false;
      if (ui.fileName) ui.fileName.textContent = file.name;
      loadFromFile(file);
      requestAnimationFrame(() => {
        if (state.stats) renderTrendTiles(state.stats);
      });
    } else if (ui.fileName) {
      ui.fileName.textContent = "No file selected";
    }
  });
}

setFilter("all");
initTheme();
renderTrendTiles({ testsRegistered: 6, duration: 1000, failures: 1, passPercent: 75, tests: 6 });
loadReport("");

window.addEventListener("resize", () => {
  if (lastMetricsStats) renderTrendTiles(lastMetricsStats);
});
