// ============================================================
// PRIVAGENT LOCAL PRIVACY SANITIZER
// ============================================================

const { PII_PATTERNS } = require("./pii-patterns");

/**
 * Strips sensitive query parameters and hash fragments from URLs.
 * Keeps only origin and pathname (e.g., https://bank.com/portal).
 * Handles percent-encoded query parameters and relative paths safely.
 *
 * @param {string} url - Target URL to sanitize.
 * @returns {string} - Clean origin + pathname.
 */
function sanitizeUrl(url) {
    if (!url || typeof url !== "string") {
        return "";
    }

    const trimmed = url.trim();
    if (!trimmed) {
        return "";
    }

    try {
        const parsed = new URL(trimmed);
        return `${parsed.origin}${parsed.pathname}`;
    } catch (_) {
        try {
            const parsed = new URL(trimmed, "http://localhost");
            return parsed.pathname;
        } catch (_) {
            return "";
        }
    }
}

/**
 * Sanitizes raw text by replacing sensitive PII and authentication
 * credentials with semantic, opaque redaction tokens.
 *
 * Guarantees:
 * 1. Idempotence: sanitizeText(sanitizeText(text)) === sanitizeText(text).
 * 2. Unicode Normalization: canonicalizes fullwidth/compatibility homoglyphs.
 * 3. Graceful degradation: non-string inputs safely return empty or coerced string.
 *
 * @param {string} text - Raw text to sanitize.
 * @returns {string} - Sanitized text with redacted entities.
 */
function sanitizeText(text) {
    if (text === null || text === undefined) {
        return "";
    }

    if (typeof text !== "string") {
        text = String(text);
    }

    if (!text) {
        return "";
    }

    let sanitized = text;

    // Unicode NFKC normalization to neutralize fullwidth and compatibility homoglyphs
    try {
        sanitized = sanitized.normalize("NFKC");
    } catch (_) {}

    // 1. Email Addresses
    sanitized = sanitized.replace(
        PII_PATTERNS.email,
        "[EMAIL_REDACTED]"
    );

    // 2. UPI IDs (remaining handles like @okhdfcbank, @upi)
    sanitized = sanitized.replace(
        PII_PATTERNS.upi,
        "[UPI_REDACTED]"
    );

    // 3. Contextual Bank Account Numbers
    sanitized = sanitized.replace(
        PII_PATTERNS.account,
        (match, p1) => match.replace(p1, "[ACCOUNT_REDACTED]")
    );

    // 4. Contextual OTP / PIN / CVV
    sanitized = sanitized.replace(
        PII_PATTERNS.otp,
        (match, p1) => match.replace(p1, "[OTP_REDACTED]")
    );

    // 5. Contextual Passwords
    sanitized = sanitized.replace(
        PII_PATTERNS.password,
        (match, p1) => match.replace(p1, "[PASSWORD_REDACTED]")
    );

    // 6. Bearer Tokens & Authorization Credentials
    sanitized = sanitized.replace(
        PII_PATTERNS.bearer,
        (match, p1) => match.replace(p1, "[BEARER_TOKEN_REDACTED]")
    );

    // 7. Contextual API Keys / Secret Tokens
    sanitized = sanitized.replace(
        PII_PATTERNS.auth_token,
        (match, p1) => match.replace(p1, "[AUTH_CREDENTIAL_REDACTED]")
    );

    // 8. International Bank Account Numbers (IBAN - evaluated before payment cards to prevent partial slicing)
    sanitized = sanitized.replace(
        PII_PATTERNS.iban,
        "[IBAN_REDACTED]"
    );

    // 9. Payment Cards (13-19 digits)
    sanitized = sanitized.replace(
        PII_PATTERNS.card,
        "[CARD_REDACTED]"
    );

    // 10. US Social Security Numbers (SSN: \d{3}-\d{2}-\d{4})
    sanitized = sanitized.replace(
        PII_PATTERNS.ssn,
        "[SSN_REDACTED]"
    );

    // 11. Indian Aadhaar Numbers (12 digits, leading digit 2-9)
    sanitized = sanitized.replace(
        PII_PATTERNS.aadhaar,
        "[AADHAAR_REDACTED]"
    );

    // 12. Indian Phone Numbers
    sanitized = sanitized.replace(
        PII_PATTERNS.phone,
        "[PHONE_REDACTED]"
    );

    // 13. US / International Phone Numbers
    sanitized = sanitized.replace(
        PII_PATTERNS.phone_intl,
        "[PHONE_REDACTED]"
    );

    // 14. Indian PAN Numbers
    sanitized = sanitized.replace(
        PII_PATTERNS.pan,
        "[PAN_REDACTED]"
    );

    return sanitized;
}

module.exports = {
    sanitizeText,
    sanitizeUrl
};
