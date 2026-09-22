const { PII_PATTERNS } = require("./pii-patterns");

function detectPII(text) {
    const findings = [];

    if (!text || typeof text !== "string") {
        return findings;
    }

    for (const [type, pattern] of Object.entries(PII_PATTERNS)) {
        const matches = text.match(pattern);

        if (matches) {
            findings.push({
                type,
                count: matches.length
            });
        }
    }

    return findings;
}

module.exports = {
    detectPII
};
