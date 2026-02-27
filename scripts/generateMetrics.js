/**
 * generateMetrics.js
 * - Reads Cypress Mochawesome merged JSON: cypress/reports/mochawesome.json
 * - Extracts pass/fail counts and duration
 * - Appends a compact run record into: dashboard/data/runs.json
 * - Keeps last 30 runs (configurable)
 */

const fs = require("fs");
const path = require("path");
//
const MAX_RUNS = 31; // git-test-change

const mochawesomePath = path.join("cypress", "reports", "results.json");
const outDir = path.join("dashboard", "data");
const outFile = path.join(outDir, "runs.json");

function safeReadJson(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (e) {
    return null;
  }
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function nowIso() {
  return new Date().toISOString();
}

function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function extractFromMochawesome(mocha) {
  const stats = mocha && mocha.stats ? mocha.stats : {};
  const tests = num(stats.tests);
  const passes = num(stats.passes);
  const failures = num(stats.failures);
  const pending = num(stats.pending);

  const durationMs = num(stats.duration);
  const durationSec = Math.max(0, Math.round(durationMs / 1000));
  const passRate = tests > 0 ? Math.round((passes / tests) * 100) : 0;

  // Extract reflective test lists
  const passedTests = [];
  const failedTests = [];

  const walkSuites = (suites) => {
    (suites || []).forEach(suite => {
      (suite.tests || []).forEach(t => {
        if (t.state === 'passed' || t.pass === true) passedTests.push(t.title);
        if (t.state === 'failed' || t.fail === true) failedTests.push(t.title);
      });
      walkSuites(suite.suites);
    });
  };
  walkSuites(mocha.results);

  return {
    tests,
    passes,
    failures,
    pending,
    durationSec,
    passRate,
    passedTests,
    failedTests
  };
}

function main() {
  const mocha = safeReadJson(mochawesomePath);

  // If mochawesome.json not found, still write a run record (for debugging)
  const extracted = mocha
    ? extractFromMochawesome(mocha)
    : {
      tests: 0,
      passes: 0,
      failures: 0,
      pending: 0,
      durationSec: 0,
      passRate: 0,
    };

  // Pull useful CI env vars if present
  const run = {
    ts: nowIso(),
    sha: process.env.GITHUB_SHA || "",
    runId: process.env.GITHUB_RUN_ID || "",
    repo: process.env.GITHUB_REPOSITORY || "",
    ...extracted,
  };

  ensureDir(outDir);

  const existing = safeReadJson(outFile);
  const runs = Array.isArray(existing) ? existing : [];

  runs.push(run);

  // Keep last MAX_RUNS
  const trimmed = runs.slice(Math.max(0, runs.length - MAX_RUNS));

  fs.writeFileSync(outFile, JSON.stringify(trimmed, null, 2), "utf8");

  console.log(`✅ Metrics saved: ${outFile}`);
  console.log(
    `   tests=${run.tests} passes=${run.passes} failures=${run.failures} passRate=${run.passRate}% duration=${run.durationSec}s`
  );
}

main();
