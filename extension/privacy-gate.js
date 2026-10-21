// ============================================================
// PRIVAGENT LOCAL PRIVACY GATE
// ============================================================

const PII_PATTERNS = {
    email: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,

    phone: /\b(?:\+91[\s-]?)?[6-9]\d{9}\b/g,

    aadhaar: /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g,

    pan: /\b[A-Z]{5}\d{4}[A-Z]\b/gi,

    card: /\b(?:\d[ -]*?){13,19}\b/g
};


// ------------------------------------------------------------
// SANITIZE TEXT
// ------------------------------------------------------------

function sanitizeText(text) {

    if (!text) {
        return "";
    }

    let sanitized = String(text);

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

            role: element.role || "",

            label: sanitizeText(
                element.label || ""
            ),

            ariaLabel: sanitizeText(
                element.ariaLabel || ""
            ),

            selector: element.selector || null,

            enabled: element.enabled !== false,

            visible: element.visible !== false
        };

    });
}


// ------------------------------------------------------------
// EXPORT
// ------------------------------------------------------------

const PrivAgentPrivacyExport = {
    sanitizeText,
    sanitizePageState
};

if (typeof globalThis !== "undefined") {
    globalThis.PrivAgentPrivacy = PrivAgentPrivacyExport;
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = PrivAgentPrivacyExport;
}

void {
    sanitizeText,
    sanitizePageState
};
