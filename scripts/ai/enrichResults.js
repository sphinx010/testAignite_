#!/usr/bin/env node
/**
 * TestAIgnite - Module 4: AI Enrichment Pipeline
 * 
 * Objective: Add deterministic, offline-safe intelligence to Cypress test reports.
 * Strategy: Post-processing of TestAIgnite JSON using Hugging Face Inference API.
 * 
 * AUTHOR: Ayooluwa Paul QA Developer
 * CONSTRAINTS: No GPU, System requirement deficits, strict word limits, fail-safe, non-blocking.
 */

const fs = require("fs");
const path = require("path");
const { HfInference } = require("@huggingface/inference");
const { glob } = require("glob");

// --- CONFIGURATION ---
const CONFIG = {
  // Candidate report files to enrich
  reportsDir: path.join(__dirname, "..", "..", "cypress", "reports", ".jsons"),
  fallbackReport: path.join(__dirname, "..", "..", "cypress", "reports", "results.json"),
  // Prioritized models: Higher parameter counts/quality, falling back to efficiency.
  models: [
    "meta-llama/Meta-Llama-3-8B-Instruct",   // Stronger general purpose & reasoning
    "mistralai/Mixtral-8x7B-Instruct-v0.1",  // High-performance MoE (may hit rate limits, but worth try)
    "microsoft/Phi-3-mini-4k-instruct"       // Efficient fallback
  ],
  // Safety thresholds
  concurrency: 1, // Sequential processing to avoid rate limits
  timeoutMs: 15000,
  maxRetries: 1, // Per model
  minRecommendWords: 30,
  maxRecommendWords: 45
};

// Initialize Hugging Face Client
const HF_API_KEY = process.env.HUGGINGFACE_API_TOKEN || process.env.HF_API_KEY || process.env.HUGGINGFACEHUB_API_TOKEN;

// Diagnostic log for CI (Redacted for safety)
if (HF_API_KEY) {
  console.log(`[DEBUG] Hugging Face API Key found (Prefix: ${HF_API_KEY.slice(0, 4)}...)`);
} else {
  console.warn("[WARN] Hugging Face API Key is MISSING. Enrichment will fail or use fallbacks.");
}

const hf = HF_API_KEY ? new HfInference(HF_API_KEY) : null;

// --- UTILITIES ---

const readJson = (p) => {
  try {
    return JSON.parse(fs.readFileSync(p, "utf-8"));
  } catch (e) {
    return null;
  }
};

const writeJson = (p, data) => fs.writeFileSync(p, JSON.stringify(data, null, 2));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const countWords = (str) => (str || "").trim().split(/\s+/).length;

const cleanText = (str) => (str || "").replace(/\n/g, " ").replace(/\s+/g, " ").trim();

/**
 * Derives fallback tags from text analysis when AI fails or returns empty tags.
 */
const deriveTags = (errorMsg, fullTitle) => {
  const text = (errorMsg + " " + fullTitle).toLowerCase();
  const tags = new Set();

  if (text.includes("timeout") || text.includes("waited")) tags.add("timing");
  if (text.includes("get") || text.includes("find") || text.includes("contains")) tags.add("selector");
  if (text.includes("401") || text.includes("403") || text.includes("login")) tags.add("auth");
  if (text.includes("500") || text.includes("fetch") || text.includes("network")) tags.add("network");
  if (text.includes("expect") || text.includes("assert")) tags.add("assertion");

  return Array.from(tags).slice(0, 4);
};

// --- CORE AI LOGIC ---

/**
 * Constructs the strict system prompt for the AI model.
 */
const buildPrompt = (test) => {
  const err = test.err || {};
  const context = {
    title: test.fullTitle || test.title,
    error: err.message || "Unknown error",
    stack: (err.stack || err.estack || "").split("\n").slice(0, 3).join(" "), // Truncate stack for token limits
    code: (test.code || "").slice(0, 500), // Include snippet of test code, capped length
    duration: test.duration,
    retries: test.retries
  };

  return `
You are a Distinguished QA DevOps Engineer and an expert Product Manager.
Your role is to analyze failures with surgical precision while teaching the user how to build resilient, enterprise-grade automation.
Focus on "Systemic Reliability", "Root Cause Analysis", and "Best Practices".

ADOPT A BALANCED PERSPECTIVE:
- Do not default to blaming the test logic.
- If the test attempted a valid user action (e.g., click) and the system failed to respond (e.g., no navigation), that is a PRODUCT ISSUE.
- Distinguish clearly between "The test failed to check X" (Test Issue) and "The test checked X, and X was broken" (Product Issue).
- If test logic is valid, justify it using observable evidence (e.g., valid trigger, correct assertion, sufficient wait window). Avoid vague phrases like "appears".

Test Context:
- Test Name: "${context.title}"
- Error Message: "${context.error}"
- Code Snippet: "${context.code}"
- Stack Trace: "${context.stack}"
- Duration: ${context.duration}ms


OUTPUT INSTRUCTIONS:
Produce a JSON object compliant with this schema:
{
  "summary": "Technical executive summary (max 15 words).",

  "humanError": "Translate the Cypress error into a clear, educational statement for non-QA stakeholders (max 20 words).",

  "testRootCause": "Analyze execution logic using evidence. State whether assertion type, trigger, and wait conditions were valid. Do not use vague phrases.",

  "productRootCause": "Infer product defects only when the system fails after a valid trigger and coherent assertion. Identify the failure layer (trigger, API, response, UI rendering, or state binding).",

  "bugEffect": "Explain the realistic business or user-experience impact IF this defect propagates to production. Do not exaggerate.",

  "inferredExpected": "Define the correct system behavior using strict declarative subjunctive mood. Start with 'The [component] should...'.",

  "recommendation": "Prescriptive fix. Use 'Fix the Test' or 'Fix the Product'. Point to exact verification steps (API call, response payload, UI binding). Avoid generic advice.",

  "severity": "low" | "medium" | "high" | "critical",

  "confidence": <number between 0.0 and 1.0>,

  "tags": ["<tag1>", "<tag2>", ...]
}

INFERENCE RULES (BAKED-IN LOGIC)

0. MANDATORY REASONING ORDER (DO NOT SKIP):
   Internally evaluate before concluding:
   - Assertion Type (UI text, URL, API, state)
   - Trigger Validity (Was a valid action executed?)
   - System Response (Did any observable effect occur?)
   - Timeout Significance (Was wait duration sufficient to rule out flakiness?)

1. Determine Test Intent FIRST:
   a. Infer intent from test title, description, and assertion type.
   b. Examples:
      - Navigation test → URL change expected
      - Security test → Access denied expected
      - Form test → Validation success expected

2. Deduction Weights:
   a. HIGH PRODUCT PROBABILITY:
      Valid action → No observable system response
      → Indicates broken state transition or ignored input

   b. HIGH TEST PROBABILITY:
      Syntax error, invalid selector, or assertion unrelated to intent

   c. TIMEOUT CLASSIFICATION:
      - Short timeout → possible test sync issue
      - Extended timeout (>= 8000ms) → strong product failure signal unless disproven

   d. ZERO EFFECT RULE:
      If action produces no UI, URL, or state change → PRODUCT DEFECT

3. Assertion Coherence:
   a. Misaligned assertion → Test Issue
   b. Aligned assertion + valid trigger + failure → Product Issue

4. Root Cause Precision:
   - Identify failure layer: trigger → API → response → UI → state binding
   - Use causal language (e.g., "Post-action state transition failed after valid trigger")
   - Avoid vague phrases

5. Recommendation Precision:
   - Direct engineer to exact checks (API call, payload, UI binding)
   - Avoid generic statements

6. Severity Calibration:
   a. Low: Cosmetic or weak assertions
   b. Medium: Functional inconsistencies
   c. High: Broken flows or contracts
   d. Critical: Security, data integrity, auth, or release blockers

7. Output Rules:
   a. Output MUST be strictly valid JSON
   b. No markdown
   c. No extra commentary
`.trim();
};

/**
 * Validates and sanitizes the AI response.
 */
const validateAndSanitize = (rawJson, originalTest) => {
  let data;
  try {
    // Attempt to extract JSON if wrapped in markdown blocks
    const match = rawJson.match(/\{[\s\S]*\}/);
    const jsonStr = match ? match[0] : rawJson;
    data = JSON.parse(jsonStr);
  } catch (e) {
    throw new Error("Malformed JSON response");
  }

  // Contract Enforcement
  const summary = cleanText(data.summary).split(" ").slice(0, 15).join(" ");

  let recommendation = cleanText(data.recommendation);
  const recWords = recommendation.split(" ");
  // Soft enforcement on recommendation length (padding if too short, truncation if too long)
  // Removed strict padding logic to trust the model's new instruction for "complete sentences".
  if (recommendation.split(" ").length < 10) {
    recommendation += " Please review the test logic and error stack for more details.";
  }
  recommendation = recommendation.replace(/\.\.\.$/, "."); // cleanup trailing dots

  // Ensure new fields exist with defaults
  return {
    summary: summary || "Investigate failure reason.",
    humanError: data.humanError || "An error occurred during the test execution.",
    testRootCause: data.testRootCause || "Assertion or selector failure detected in test code.",
    productRootCause: data.productRootCause || "Possible defect in application logic or responsiveness.",
    bugEffect: data.bugEffect || "User flow is blocked or behavior is inconsistent.",
    inferredExpected: data.inferredExpected || "The application should behave as defined in the test requirement.",
    recommendation: recommendation,
    severity: ["low", "medium", "high", "critical"].includes(data.severity?.toLowerCase())
      ? data.severity.toLowerCase()
      : "medium",
    confidence: typeof data.confidence === "number" ? Math.min(Math.max(data.confidence, 0), 1) : 0.5,
    tags: Array.isArray(data.tags) && data.tags.length > 0
      ? data.tags.slice(0, 5)
      : deriveTags(originalTest.err?.message, originalTest.title)
  };
};

/**
 * Calls Hugging Face API with retries and model fallbacks.
 */
const getAiInsight = async (test) => {
  if (!hf) throw new Error("API Key missing");
  const prompt = buildPrompt(test);

  for (const model of CONFIG.models) {
    try {
      // Rate limiting buffer
      if (model !== CONFIG.models[0]) await sleep(2000);

      console.log(`  > Analyzing with ${model}...`);

      const response = await hf.chatCompletion({
        model: model,
        messages: [{ role: "user", content: prompt }],
        max_tokens: 500, // Increased to prevent cutoffs
        temperature: 0.3, // Pedagogical tone requires slightly more freedom
        top_p: 0.95
      });

      const content = response.choices[0]?.message?.content; /// i need to look at this again
      if (!content) throw new Error("Empty response");

      const enriched = validateAndSanitize(content, test);
      enriched.modelUsed = model; // Attach model metadata
      return enriched;

    } catch (err) {
      console.warn(`    x Model ${model} failed: ${err.message}`);
      // Continue to next model
    }
  }
  throw new Error("All AI models failed");
};

/**
 * Generates a fallback object when AI is unavailable.
 */
const getFallbackInsight = (test) => {
  const msg = test.err?.message || "";
  return {
    summary: "AI analysis unavailable.",
    recommendation: "Manual review required. Check the error logs and screenshot artifacts to diagnose the issue.",
    severity: "medium",
    confidence: 0.0,
    tags: ["ai-unavailable", ...deriveTags(msg, test.title)]
  };
};

// --- MAIN PIPELINE ---

const runPipeline = async () => {
  console.log("[INFO] Starting AI Enrichment Pipeline (Batch Mode)...");

  // 1. Locate and Rename Anonymous Reports to Spec-Aware Names
  const reportsFolder = path.resolve(CONFIG.reportsDir).replace(/\\/g, '/');
  const rawFiles = await glob(`${reportsFolder}/*.json`);

  for (const f of rawFiles) {
    const fileName = path.basename(f);
    if (fileName.startsWith("results_") || fileName === "results.json") {
      try {
        const data = JSON.parse(fs.readFileSync(f, 'utf-8'));
        // Try to get spec name from file path or title
        const specFile = data.results?.[0]?.file || data.results?.[0]?.fullFile || "";
        let specName = specFile ? path.basename(specFile).replace(/\.cy\.js$|\.js$/, '') : (data.results?.[0]?.title || "unknown");
        specName = specName.replace(/[^a-z0-9]/gi, '_').toLowerCase();

        const newPath = path.join(path.dirname(f), `${specName}_results.json`);
        if (f !== newPath && !fs.existsSync(newPath)) {
          fs.renameSync(f, newPath);
          console.log(`[INFO] Renamed report ${fileName} -> ${path.basename(newPath)}`);
        }
      } catch (e) {
        console.warn(`[WARN] Failed to rename ${f}: ${e.message}`);
      }
    }
  }

  // 2. Discover Final Candidates
  const files = await glob(`${reportsFolder}/*.json`);
  if (files.length === 0 && fs.existsSync(CONFIG.fallbackReport)) {
    files.push(CONFIG.fallbackReport);
  }

  if (files.length === 0) {
    console.warn("[WARN] No report files found. Paths searched:", path.join(CONFIG.reportsDir, "*.json"));
    process.exit(0);
  }

  console.log(`[INFO] Found ${files.length} report part(s) to process.`);

  for (const reportPath of files) {
    console.log(`\n--- Processing Report: ${path.basename(reportPath)} ---`);

    // 2. Load Data
    const report = readJson(reportPath);
    if (!report || !report.results) {
      console.warn(`[WARN] Skipping invalid report: ${reportPath}`);
      continue;
    }

    // 3. Identify Candidates
    let candidates = [];
    report.results.forEach(suite => {
      // Handle both root tests and nested suites
      const processSuite = (s) => {
        (s.tests || []).forEach(test => {
          if ((test.fail || test.state === 'failed') && !test.ai) {
            candidates.push(test);
          }
        });
        (s.suites || []).forEach(processSuite);
      };
      processSuite(suite);
    });

    if (candidates.length === 0) {
      console.log(`[INFO] No failed tests requiring enrichment in ${path.basename(reportPath)}.`);
      continue;
    }

    console.log(`[INFO] Found ${candidates.length} failed tests to enrich.`);

    // 4. Enrich Candidates (Sequential)
    let enrichedCount = 0;
    for (const test of candidates) {
      console.log(`  > Analyzing failure: "${test.fullTitle || test.title}"`);
      try {
        test.ai = await getAiInsight(test);
        console.log("    [SUCCESS] Injected AI insights");
        enrichedCount++;
      } catch (e) {
        console.warn("    [WARN] Enrichment failed, converting to fallback.");
        test.ai = getFallbackInsight(test);
      }
    }

    // 5. Save Report
    try {
      writeJson(reportPath, report);
      console.log(`[INFO] Saved enriched report to ${reportPath}`);
    } catch (e) {
      console.error(`[ERROR] Failed to write report ${reportPath}: ${e.message}`);
    }
  }
  console.log("\n[INFO] AI Enrichment Pipeline Complete.");
};

// Execute
runPipeline().catch(err => {
  console.error("[FATAL] Pipeline Error:", err);
  process.exit(1);
});
