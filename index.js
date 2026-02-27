/**
 * TestAIgnite Reporter
 * Public API
 */

const { enrichResults } = require('./src/enrichResults');
const { generateHtmlReport } = require('./src/renderHtmlReport');

module.exports = {
    enrichResults,
    generateHtmlReport
};
