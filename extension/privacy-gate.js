// ============================================================
// PRIVAGENT LOCAL PRIVACY GATE
// ============================================================

const PII_PATTERNS = {
    email: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,

    // Indian phone numbers: +91 or 10-digit starting 6-9
    phone: /\b(?:\+91[\s-]?)?[6-9]\d{9}\b/g,

    // Indian Aadhaar: 12 digits, first digit 2-9 to prevent false positives on order IDs
    aadhaar: /\b[2-9]\d{3}[\s-]?\d{4}[\s-]?\d{4}\b/g,

    // Indian PAN card: 5 letters + 4 digits + 1 letter
    pan: /\b[A-Z]{5}\d{4}[A-Z]\b/gi,

    // Payment Cards: 13-19 digits
    card: /\b(?:\d[ -]?){13,19}\b/g,

    // UPI IDs: e.g. user@okhdfcbank, merchant@upi, 9876543210@paytm
    upi: /\b[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z]{2,64}\b/gi,

    // Contextual OTP / PIN / CVV: e.g., OTP: 492810, PIN: 1234, CVV: 891
    otp: /\b(?:otp|one[- ]?time[- ]?password|verification[- ]?code|pin|cvv|cvc)[:\s-]+([0-9]{3,8})\b/gi,

    // Contextual Bank Account Number: e.g., A/C No: 123456789012, Account: 987654321098
    account: /\b(?:a\/c|account|acc)(?:\s+no\.?|\s+number)?[:\s-]+([0-9]{9,18})\b/gi
};


// ------------------------------------------------------------
// SANITIZE TEXT
// ------------------------------------------------------------

function sanitizeText(text) {

    if (!text) {
        return "";
    }

    let sanitized = String(text);

    // 1. Emails first
    sanitized = sanitized.replace(
        PII_PATTERNS.email,
        "[EMAIL_REDACTED]"
    );

    // 2. UPI IDs (remaining @ handles like @okhdfcbank, @upi)
    sanitized = sanitized.replace(
        PII_PATTERNS.upi,
        "[UPI_REDACTED]"
    );

    // 3. Contextual Account Number
    sanitized = sanitized.replace(
        PII_PATTERNS.account,
        (match, p1) => match.replace(p1, "[ACCOUNT_REDACTED]")
    );

    // 4. Contextual OTP / PIN
    sanitized = sanitized.replace(
        PII_PATTERNS.otp,
        (match, p1) => match.replace(p1, "[OTP_REDACTED]")
    );

    // 5. Payment cards (13-19 digits - evaluated before 12-digit Aadhaar and 10-digit Phone)
    sanitized = sanitized.replace(
        PII_PATTERNS.card,
        "[CARD_REDACTED]"
    );

    // 6. Aadhaar numbers (12 digits)
    sanitized = sanitized.replace(
        PII_PATTERNS.aadhaar,
        "[AADHAAR_REDACTED]"
    );

    // 7. Phone numbers (10 digits)
    sanitized = sanitized.replace(
        PII_PATTERNS.phone,
        "[PHONE_REDACTED]"
    );

    // 8. PAN numbers
    sanitized = sanitized.replace(
        PII_PATTERNS.pan,
        "[PAN_REDACTED]"
    );

    return sanitized;
}


// ------------------------------------------------------------
// SANITIZE PAGE STATE
// ------------------------------------------------------------

function sanitizePageState(pageState) {

    if (!pageState) {
        throw new Error("Page state is required.");
    }

    return {
        title: sanitizeText(pageState.title || ""),

        url: sanitizeUrl(pageState.url),

        text: sanitizeText(pageState.text || ""),

        elements: sanitizeElements(
            pageState.elements || []
        )
    };
}


// ------------------------------------------------------------
// SANITIZE URL
// ------------------------------------------------------------

function sanitizeUrl(url) {

    if (!url) {
        return "";
    }

    try {

        const parsed = new URL(url);

        // Keep only origin + pathname.
        // Query parameters can contain sensitive information.
        return `${parsed.origin}${parsed.pathname}`;

    } catch (_) {

        return "";
    }
}


// ------------------------------------------------------------
// SANITIZE ELEMENTS
// ------------------------------------------------------------

function sanitizeElements(elements) {

    return elements.map(element => {

        return {
            id: element.id || null,

            type: element.type || "",

            label: sanitizeText(
                element.label || ""
            ),

            selector: element.selector || null,

            enabled: element.enabled !== false
        };

    });
}


// ------------------------------------------------------------
// EXPORT
// ------------------------------------------------------------

globalThis.PrivAgentPrivacy = {
    PII_PATTERNS,
    sanitizeText,
    sanitizeUrl,
    sanitizePageState
};

if (typeof module !== "undefined" && module.exports) {
    module.exports = {
        PrivAgentPrivacy: globalThis.PrivAgentPrivacy,
        PII_PATTERNS,
        sanitizeText,
        sanitizeUrl,
        sanitizePageState
    };
}
