# TestAIgnite Reporter

TestAIgnite: an enterprise Cypress framework using Llama-3, Mixtral, and Phi-3 to perform AI-driven failure analysis and intelligent CI reporting. Less noise. More signal. 

## Installation

Install the package as a dev dependency in your project:

\`\`\`bash
# If hosted on GitHub
npm install -D github:sphinx010/testaignite-reporter
\`\`\`

## Quick Start

You must first have your Cypress tests configured to output `.jsons` fragments (e.g., via `mochawesome-reporter`). 

This package expects to find your test results at: `./cypress/reports/.jsons/*.json`. It will merge them, run them through an AI enrichment pipeline, and spit out an artifact at `./cypress/reports/html/testaignite-report.html`.

### 1. Set your API Key
To use the AI enrichment features, you must provide a valid Hugging Face API token. Set this in your environment or CI/CD secrets:
\`\`\`bash
export HUGGINGFACE_API_TOKEN="hf_your_token_here"
\`\`\`

*(If no token is found, the reporter will safely fall back to generating the HTML report without AI insight tags).*

### 2. Generate the Report
Run the CLI directly:
\`\`\`bash
npx testaignite report:full
\`\`\`
This will:
1. Scan for the failed tests.
2. Send failing assertion contexts to the AI model.
3. Bundle the responses and test statuses into a stunning standalone HTML file.

## CLI Commands

- `npx testaignite report:ai` - Runs strictly the AI post-processing payload generation.
- `npx testaignite report:html` - Takes the resulting payload and wraps it into the UI.
- `npx testaignite report:full` - Executes both steps sequentially.

## Programmatic API

You can also import the core functions explicitly if you need to build them into a larger node script:

\`\`\`javascript
const { enrichResults, generateHtmlReport } = require('testaignite-reporter');

// Use custom directory targets if desired
const options = {
    reportsDir: './custom/path/.jsons',
    outputDir: './custom/path/html'
};

await enrichResults(options);
generateHtmlReport(options);
\`\`\`
