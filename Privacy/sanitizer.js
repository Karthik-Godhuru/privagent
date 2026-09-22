const { PII_PATTERNS } = require("./pii-patterns");

function sanitizeText(text) {
    if (!text || typeof text !== "string") {
        return text;
    }

    let sanitized = text;

    sanitized = sanitized.replace(
        PII_PATTERNS.email,
        "[EMAIL_REDACTED]"
    );

    sanitized = sanitized.replace(
        PII_PATTERNS.phone,
        "[PHONE_REDACTED]"
    );

    sanitized = sanitized.replace(
        PII_PATTERNS.aadhaar,
        "[AADHAAR_REDACTED]"
    );

    sanitized = sanitized.replace(
        PII_PATTERNS.pan,
        "[PAN_REDACTED]"
    );

    sanitized = sanitized.replace(
        PII_PATTERNS.card,
        "[CARD_REDACTED]"
    );

    return sanitized;
}

module.exports = {
    sanitizeText
};
