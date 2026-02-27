/**
 * Run Cypress + AI + HTML report across multiple environments in one go.
 * Usage:
 *   node scripts/runAllEnvs.js           // runs all env files in cypress/config/*.env.json
 *   node scripts/runAllEnvs.js landing admin  // runs only the listed environments
 *
 * Reports for each env are stored under cypress/reports_by_env/<env>/ to avoid clobbering.
 */

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const projectRoot = path.join(__dirname, "..");
const envDir = path.join(projectRoot, "cypress", "config");
const reportsRoot = path.join(projectRoot, "cypress", "reports");
const perEnvRoot = path.join(projectRoot, "cypress", "reports_by_env");

const run = (cmd) => execSync(cmd, { stdio: "inherit", cwd: projectRoot });

const listEnvFiles = () =>
  fs
    .readdirSync(envDir)
    .filter((f) => f.endsWith(".env.json"))
    .map((f) => f.replace(/\.env\.json$/, ""));

const copyReports = (env) => {
  if (!fs.existsSync(reportsRoot)) return;
  const dest = path.join(perEnvRoot, env);
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
  fs.cpSync(reportsRoot, dest, { recursive: true });
  console.log(`Saved reports to ${path.relative(projectRoot, dest)}`);
};

const main = () => {
  const requestedEnvs = process.argv.slice(2);
  const availableEnvs = listEnvFiles();

  if (availableEnvs.length === 0) {
    throw new Error("No environment files found in cypress/config/*.env.json");
  }

  const envsToRun = requestedEnvs.length ? requestedEnvs : availableEnvs;
  const missing = envsToRun.filter((env) => !availableEnvs.includes(env));
  if (missing.length) {
    throw new Error(
      `Unknown environment(s): ${missing.join(
        ", "
      )}. Available: ${availableEnvs.join(", ")}`
    );
  }

  // Fresh start
  run("npm run clean:reports");

  envsToRun.forEach((env, idx) => {
    console.log(`\n=== Running environment: ${env} (${idx + 1}/${envsToRun.length}) ===`);
    try {
      run(`npx cypress run --browser chrome --env environment=${env}`);
    } catch (err) {
      console.warn(`Cypress run failed for env '${env}'. Continuing.`, err?.message || err);
    }
    try {
      run("npm run ai:ignite");
      run("npm run report:html");
      copyReports(env);
    } catch (err) {
      console.warn(`Post-processing failed for env '${env}'. Continuing.`, err?.message || err);
    }

    // Clean between environments to avoid cross-contamination
    if (idx < envsToRun.length - 1) {
      run("npm run clean:reports");
    }
  });

  console.log("\nAll requested environments processed.");
};

main();
