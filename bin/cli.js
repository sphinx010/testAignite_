#!/usr/bin/env node

const { enrichResults } = require('../src/enrichResults');
const { generateHtmlReport } = require('../src/renderHtmlReport');

const command = process.argv[2];

const printHelp = () => {
    console.log(`
TestAIgnite Reporter CLI

Usage:
  npx testaignite <command>

Commands:
  report:ai      Run AI enrichment on Mochawesome JSON reports (Requires HUGGINGFACE_API_TOKEN)
  report:html    Generate the final standalone HTML report
  report:full    Run AI enrichment then generate HTML report

Example:
  npx testaignite report:full
  `);
};

const run = async () => {
    try {
        switch (command) {
            case 'report:ai':
                await enrichResults();
                break;

            case 'report:html':
                generateHtmlReport();
                break;

            case 'report:full':
                await enrichResults();
                generateHtmlReport();
                break;

            default:
                console.error(`Unknown command: ${command}`);
                printHelp();
                process.exit(1);
        }
    } catch (err) {
        console.error('[FATAL] CLI Error:', err);
        process.exit(1);
    }
};

run();
