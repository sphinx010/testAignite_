const fs = require('fs');
const path = require('path');
const handlebars = require('handlebars');
const { globSync } = require('glob');
const _ = require('lodash');

/**
 * MODULE 5: Branded Offline HTML Report Generator
 * 
 * Injects `results.json` + `styles` + `scripts` into `TestUI/index.html`.
 * Outputs a single self-contained artifact.
 */

// --- CONFIG ---
const PATHS = {
    results: path.join(__dirname, '../../cypress/reports/results.json'),
    baseResults: path.join(__dirname, '../../cypress/reports/.jsons/results.json'),
    template: path.join(__dirname, '../../TestUI/index.html'),
    styles: path.join(__dirname, '../../TestUI/styles.css'),
    app: path.join(__dirname, '../../TestUI/app.js'),
    outputDir: path.join(__dirname, '../../cypress/reports/html'),
    outputFile: 'testaignite-report.html'
};

// --- HELPERS ---

// Read file safe
const readFile = (p) => {
    if (fs.existsSync(p)) return fs.readFileSync(p, 'utf-8');
    return null;
};

// Merges multiple Mochawesome JSON parts into a single master report
const getResults = () => {
    console.log("🔍 Scanning for report parts in .jsons folder...");
    const reportsFolder = path.resolve(__dirname, '../../cypress/reports/.jsons').replace(/\\/g, '/');
    const globPattern = `${reportsFolder}/*.json`;
    const files = globSync(globPattern);

    if (files.length === 0) {
        console.log("⚠️ No specific parts found. Pattern used:", globPattern);
        if (fs.existsSync(PATHS.results)) return JSON.parse(fs.readFileSync(PATHS.results, 'utf-8'));
        if (fs.existsSync(PATHS.baseResults)) return JSON.parse(fs.readFileSync(PATHS.baseResults, 'utf-8'));
        return null;
    }

    console.log(`📦 Found ${files.length} report part(s). Merging...`);

    const master = {
        stats: {
            suites: 0, tests: 0, passes: 0, pending: 0, failures: 0,
            start: new Date().toISOString(), end: new Date().toISOString(),
            duration: 0, testsRegistered: 0, passPercent: 0, pendingPercent: 0,
            other: 0, hasOther: false, skipped: 0, hasSkipped: false
        },
        results: [],
        meta: {}
    };

    files.forEach(f => {
        const data = JSON.parse(fs.readFileSync(f, 'utf-8'));

        // Merge Stats
        master.stats.suites += data.stats.suites || 0;
        master.stats.tests += data.stats.tests || 0;
        master.stats.passes += data.stats.passes || 0;
        master.stats.pending += data.stats.pending || 0;
        master.stats.failures += data.stats.failures || 0;
        master.stats.duration += data.stats.duration || 0;
        master.stats.testsRegistered += data.stats.testsRegistered || 0;
        master.stats.skipped += data.stats.skipped || 0;

        // Merge Results
        if (data.results) {
            master.results.push(...data.results);
        }

        // Use the latest meta
        master.meta = data.meta;
    });

    // Re-calculate percentages
    if (master.stats.testsRegistered > 0) {
        master.stats.passPercent = (master.stats.passes / master.stats.testsRegistered) * 100;
        master.stats.pendingPercent = (master.stats.pending / master.stats.testsRegistered) * 100;
    }

    return master;
};

// Normalize duration
const formatDuration = (ms) => {
    if (!ms) return "0.0m";
    const min = ms / 1000 / 60;
    return min.toFixed(1) + "m";
};

// --- DATA NORMALIZATION LAYER ---

const flattenTests = (report) => {
    const tests = [];
    const suites = new Set();
    const results = report.results || [];

    const walk = (suite) => {
        if (suite.title) suites.add(suite.title);

        (suite.tests || []).forEach(t => {
            const hasBase64 = (typeof t.context === 'string' && t.context.includes('data:image')) ||
                (Array.isArray(t.context) && JSON.stringify(t.context).includes('data:image'));
            if (hasBase64) console.log(`  [DEBUG] Found embedded screenshot for nested test: ${t.title}`);

            tests.push({
                status: t.state === 'failed' || t.fail ? 'failed' : t.state === 'passed' || t.pass ? 'passed' : 'skipped',
                title: t.title,
                fullTitle: t.fullTitle,
                duration: t.duration,
                tags: (t.title.match(/\[([^\]]+)\]/g) || []).map(s => s.replace(/[\[\]]/g, '')),
                error: t.err?.message || "",
                context: t.context || null,
                ai: t.ai || null
            });
        });

        (suite.suites || []).forEach(walk);
    };

    results.forEach(res => {
        (res.tests || []).forEach(t => { // Root tests
            const hasBase64 = (typeof t.context === 'string' && t.context.includes('data:image')) ||
                (Array.isArray(t.context) && JSON.stringify(t.context).includes('data:image'));
            if (hasBase64) console.log(`  [DEBUG] Found embedded screenshot for root test: ${t.title}`);

            tests.push({
                status: t.state === 'failed' || t.fail ? 'failed' : t.state === 'passed' || t.pass ? 'passed' : 'skipped',
                title: t.title,
                fullTitle: t.fullTitle,
                duration: t.duration,
                tags: (t.title.match(/\[([^\]]+)\]/g) || []).map(s => s.replace(/[\[\]]/g, '')),
                error: t.err?.message || "",
                context: t.context || null,
                ai: t.ai || null
            });
        });
        (res.suites || []).forEach(walk);
    });

    return { tests, suites: Array.from(suites) };
};

// --- BUILDER ---

const build = () => {
    console.log("🔨 Starting HTML Report Build...");

    // 1. Data Ingestion
    const report = getResults();
    if (!report) {
        console.error("❌ No results.json found. Run tests first.");
        process.exit(1);
    }

    // 2. Normalize View Model
    const { tests, suites } = flattenTests(report);
    const stats = {
        tests: tests.length,
        failures: tests.filter(t => t.status === 'failed').length,
        passes: tests.filter(t => t.status === 'passed').length,
        passPercent: tests.length ? ((tests.filter(t => t.status === 'passed').length / tests.length) * 100).toFixed(1) : "0.0",
        duration: formatDuration(report.stats?.duration || 0),
        statusLabel: tests.some(t => t.status === 'failed') ? "FAIL" : "PASS",
        statusClass: tests.some(t => t.status === 'failed') ? "bad" : "ok"
    };

    const viewModel = {
        meta: { timestamp: new Date().toLocaleString() },
        stats,
        tests,
        suites,
        // JSON Payload for Client-Side Hydration
        payload: JSON.stringify(report)
    };

    // 3. Template Compilation (Recursive)
    const source = readFile(PATHS.template);
    if (!source) {
        console.error(`❌ Template not found at ${PATHS.template}`);
        process.exit(1);
    }

    // Pass 1: Compile the main template structure
    const template = handlebars.compile(source);
    let html = template(viewModel);

    // Pass 2: Re-compile the resulting HTML to catch nested placeholders (common in complex UIs)
    // This ensures things like `{{stats.tests}}` inside the donut chart are resolved.
    try {
        const pass2 = handlebars.compile(html);
        html = pass2(viewModel);
    } catch (e) {
        console.warn("⚠️ Secondary compilation skipped (safe mode).");
    }

    // 4. Asset Inlining
    console.log("📦 Inlining assets...");
    const css = readFile(PATHS.styles);
    const js = readFile(PATHS.app);

    if (css) {
        // Replace <link rel="stylesheet" href="styles.css" /> with <style>...</style>
        html = html.replace('<link rel="stylesheet" href="styles.css" />', `<style>\n${css}\n</style>`);
    }

    if (js) {
        // Replace <script src="app.js"></script> with inline script + data injection
        const injection = `
    <script>
      window.TESTAIGNITE_DATA = ${viewModel.payload};
      // Prevent double-parsing if checking
    </script>
    <script>
      ${js}
    </script>
    `;
        html = html.replace('<script src="app.js"></script>', injection);
    }

    // 5. Output
    if (!fs.existsSync(PATHS.outputDir)) {
        fs.mkdirSync(PATHS.outputDir, { recursive: true });
    }

    const finalPath = path.join(PATHS.outputDir, PATHS.outputFile);
    fs.writeFileSync(finalPath, html);

    // Also persist the master merged JSON for downstream metrics scripts
    const masterJsonPath = path.join(PATHS.outputDir, "../results.json");
    fs.writeFileSync(masterJsonPath, viewModel.payload);

    console.log(`✅ Report generated at: ${finalPath}`);
    console.log(`📦 Master JSON saved at: ${masterJsonPath}`);
};

build();
