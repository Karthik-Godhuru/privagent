// ============================================================
// PRIVAGENT PII DETECTOR
// ============================================================

const { PII_PATTERNS } = require("./pii-patterns");

/**
 * Scans text for declared PII and sensitive credentials.
 * Applies Unicode NFKC normalization to catch compatibility variants
 * (such as fullwidth characters: ｕｓｅｒ＠ｅｘａｍｐｌｅ．ｃｏｍ).
 *
 * @param {string} text - Raw input text to inspect.
 * @returns {Array<{type: string, count: number}>} - Detected entity types and occurrence counts.
 */
function detectPII(text) {
    const findings = [];

    if (!text || typeof text !== "string") {
        return findings;
    }

    let normalized = text;
    try {
        normalized = normalized.normalize("NFKC");
    } catch (_) {
        // Fall back to raw text if normalize is unsupported
    }

    for (const [type, pattern] of Object.entries(PII_PATTERNS)) {
        if (pattern.global) {
            pattern.lastIndex = 0;
        }

        const matches = normalized.match(pattern);

        if (matches && matches.length > 0) {
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
