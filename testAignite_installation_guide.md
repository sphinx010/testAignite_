# 🚀 Installing & Configuring testAIgnite

Welcome to **testAIgnite**! This guide will walk you through successfully installing the package as a GitHub dependency and wiring up the required [.json](file:///c:/Users/Ayooluwa/Documents/Opex/RegWatch/package.json) reporters so that our AI models can ingest your test results.

---

## 🛑 Common Installation Pitfall (SSH vs HTTPS)

Before you begin, note that directly running `npm install github:sphinx010/testaignite-reporter` will often fail if your local machine does not have an SSH key explicitly registered with GitHub. 

NPM defaults to `git@github.com` (SSH) for the shorthand target, resulting in a **`Permission denied (publickey)`** error.

To avoid this frustration entirely, you must install the package over secure HTTPS using the `git+https` protocol.

---

## Step 1: Install the Dependencies

You need to install two packages:
1. The **`testaignite`** CLI itself.
2. The **`cypress-mochawesome-reporter`**. (testAIgnite requires raw JSON fragments of the test run to feed the LLM; the default Cypress reporter cannot do this).

Open your terminal at the root of your Cypress project and run:

```bash
# Correctly install via git+https, avoiding SSH credential blocks
npm install -D git+https://github.com/sphinx010/testAignite_.git cypress-mochawesome-reporter
```

---

## Step 2: Configure Cypress

Now that the packages are installed, you need to tell Cypress to use the mochawesome reporter and output the [.json](file:///c:/Users/Ayooluwa/Documents/Opex/RegWatch/package.json) fragments to the exact directory where testAIgnite expects to find them (`cypress/reports/.jsons`).

### A. Update [cypress.config.ts](file:///c:/Users/Ayooluwa/Documents/Opex/RegWatch/cypress.config.ts) (or `.js`)
Add the reporter options and register the plugin in your Node setup events:

```typescript
import { defineConfig } from 'cypress';

export default defineConfig({
  // 1. Tell Cypress to use the underlying mochawesome reporter
  reporter: 'cypress-mochawesome-reporter',
  reporterOptions: {
    reportDir: 'cypress/reports',
    overwrite: false,
    html: false,     // TestAIgnite builds a much better HTML report for you
    json: true       // CRITICAL: We need JSON fragments for the AI to parse!
  },
  e2e: {
    setupNodeEvents(on, config) {
      // 2. Register the plugin
      require('cypress-mochawesome-reporter/plugin')(on);
    },
    baseUrl: 'http://localhost:3000', // Example
  },
});
```

### B. Update [cypress/support/e2e.ts](file:///c:/Users/Ayooluwa/Documents/Opex/RegWatch/cypress/support/e2e.ts) (or `.js`)
Import the Mochawesome register module so it fires correctly during the test run.

```typescript
// At the top of cypress/support/e2e.ts
import 'cypress-mochawesome-reporter/register';
```

---

## Step 3: Wire Up the Pipeline ([package.json](file:///c:/Users/Ayooluwa/Documents/Opex/RegWatch/package.json))

To get the full "Zero-Noise" AI insight report, you need the tests to run, output their JSON, and *then* trigger the testAIgnite CLI to scan those JSONs.

Add these convenience scripts to your [package.json](file:///c:/Users/Ayooluwa/Documents/Opex/RegWatch/package.json):

```json
"scripts": {
  // 1. A cleanup script so old JSONs don't poison new reports
  "clean:reports": "rm -rf cypress/reports",
  
  // 2. The standard Cypress run
  "cypress:run": "cypress run",
  
  // 3. THE MAGIC PUSH-BUTTON: Run tests -> Generate AI Report
  "cypress:run:ai": "npm run clean:reports && cypress run && npx testaignite report:full"
}
```

---

## Step 4: Add Your AI Token

testAIgnite requires an LLM to generate the failure root-cause analysis. It looks for your HuggingFace token in the execution environment.

If you don't supply a token, it acts gracefully: it will still build the HTML artifact highlighting failures, but the AI insight bubbles will be blank.

```bash
# Export your token (Mac/Linux)
export HUGGINGFACE_API_TOKEN="hf_your_token_here"

# Set your token (Windows CMD)
set HUGGINGFACE_API_TOKEN="hf_your_token_here"

# Set your token (Windows PowerShell)
$env:HUGGINGFACE_API_TOKEN="hf_your_token_here"
```

---

## Step 5: Ignite! 🔥

You are fully configured! Run the script:

```bash
npm run cypress:run:ai
```

1. Cypress will run your tests.
2. Mochawesome will invisibly dump JSON fragments into `cypress/reports/.jsons`.
3. testAIgnite will immediately ingest the failures, query the LLM, and output your final `testaignite-report.html`.
