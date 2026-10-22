// ============================================================
// PRIVAGENT LOCAL PRIVACY GATE
// ============================================================

const PII_PATTERNS = {
    // 1. Email Addresses
    email: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/gi,

    // 2. UPI IDs (e.g. user@okhdfcbank, merchant@upi, 9876543210@paytm)
    upi: /\b[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z]{2,64}\b/gi,

    // 3. Contextual Bank Account Numbers (e.g., A/C No: 123456789012, Account: 987654321098)
    account: /\b(?:a\/c|account|acc|acct)(?:\s+no\.?|\s+number|\s+#)?[:\s-]+([0-9]{9,18})\b/gi,

    // 4. Contextual OTP / PIN / CVV (e.g., OTP: 492810, PIN: 1234, CVV: 891)
    otp: /\b(?:otp|one[- ]?time[- ]?password|verification[- ]?code|security[- ]?code|pin|cvv|cvc)[:\s-]+([0-9]{3,8})\b/gi,

    // 5. Contextual Passwords (e.g., password: MySecretPass123, passwd: abc)
    password: /\b(?:password|passwd|pwd)[:\s=]+([^\s,;]{4,})\b/gi,

    // 6. Bearer Tokens & Authorization Credentials
    bearer: /\bBearer\s+([A-Za-z0-9_\-\.]{16,})\b/gi,

    // 7. Contextual API Keys & Secret Tokens
    auth_token: /\b(?:api[-_]?key|secret[-_]?key|auth[-_]?token|access[-_]?token|private[-_]?key)[:\s=]+([A-Za-z0-9_\-\.]{12,})\b/gi,

    // 8. International Bank Account Numbers (IBAN: 2 letters + 2 digits + up to 30 alphanumeric)
    iban: /\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{2,4}){3,8}\b/gi,

    // 9. Payment Cards (13-19 digits, evaluated after IBAN)
    card: /\b(?:\d[ -]?){13,19}\b/g,

    // 10. US Social Security Numbers (SSN: 3 digits - 2 digits - 4 digits)
    ssn: /\b\d{3}-\d{2}-\d{4}\b/g,

    // 11. Indian Aadhaar (12 digits, first digit 2-9 to avoid false positives on 0/1 order IDs)
    aadhaar: /\b[2-9]\d{3}[\s-]?\d{4}[\s-]?\d{4}\b/g,

    // 12. Indian Phone Numbers (+91 or 10 digits starting 6-9)
    phone: /\b(?:\+91[\s-]?)?[6-9]\d{9}\b/g,

    // 13. US / International Phone Numbers (10 digits with standard delimiters)
    phone_intl: /\b(?:\+1[\s-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/g,

    // 14. Indian PAN Card (5 uppercase letters + 4 digits + 1 uppercase letter)
    pan: /\b[A-Z]{5}\d{4}[A-Z]\b/gi
};


// ------------------------------------------------------------
// SANITIZE TEXT
// ------------------------------------------------------------

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

    // Unicode NFKC normalization
    try {
        sanitized = sanitized.normalize("NFKC");
    } catch (_) {}

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

    // 8. International Bank Account Numbers (IBAN)
    sanitized = sanitized.replace(
        PII_PATTERNS.iban,
        "[IBAN_REDACTED]"
    );

    // 9. Payment cards (13-19 digits)
    sanitized = sanitized.replace(
        PII_PATTERNS.card,
        "[CARD_REDACTED]"
    );

    // 10. US Social Security Numbers (SSN)
    sanitized = sanitized.replace(
        PII_PATTERNS.ssn,
        "[SSN_REDACTED]"
    );

    // 11. Aadhaar numbers (12 digits)
    sanitized = sanitized.replace(
        PII_PATTERNS.aadhaar,
        "[AADHAAR_REDACTED]"
    );

    // 12. Indian Phone numbers (10 digits)
    sanitized = sanitized.replace(
        PII_PATTERNS.phone,
        "[PHONE_REDACTED]"
    );

    // 13. US / International Phone numbers
    sanitized = sanitized.replace(
        PII_PATTERNS.phone_intl,
        "[PHONE_REDACTED]"
    );

    // 14. PAN numbers
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
        elements: sanitizeElements(pageState.elements || [])
    };
}


// ------------------------------------------------------------
// SANITIZE URL
// ------------------------------------------------------------

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
        // Keep only origin + pathname.
        // Query parameters and hash fragments can contain sensitive information.
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


// ------------------------------------------------------------
// SANITIZE ELEMENTS
// ------------------------------------------------------------

function sanitizeElements(elements) {
    if (!Array.isArray(elements)) {
        return [];
    }

    return elements.map(element => {
        if (!element || typeof element !== "object") {
            return null;
        }

        return {
            id: element.id || null,
            type: element.type || "",
            subtype: element.subtype || "",
            label: sanitizeText(element.label || ""),
            selector: element.selector || null,
            enabled: element.enabled !== false,
            isSubmit: Boolean(element.isSubmit)
        };
    }).filter(Boolean);
}


// ------------------------------------------------------------
// DETECT PII
// ------------------------------------------------------------

function detectPII(text) {
    const findings = [];
    if (!text || typeof text !== "string") {
        return findings;
    }

    let normalized = text;
    try {
        normalized = normalized.normalize("NFKC");
    } catch (_) {}

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

const FORBIDDEN_STRUCTURAL_INDICATORS = [
    "document.body.innerText",
    "data:image/png;base64",
    "data:image/jpeg;base64",
    "<html",
    "<body",
    "<script"
];

const SENSITIVE_CONTROL_KEYWORDS = [
    "password", "passwd", "secret", "cvv", "cvc",
    "otp", "pin", "auth_token", "aadhaar", "card_number"
];

// ------------------------------------------------------------
// INSPECT OUTBOUND PAYLOAD & EGRESS GUARD
// ------------------------------------------------------------

function inspectOutboundPayload(payload, canaries = []) {
    const violations = [];

    if (payload === null || payload === undefined) {
        return {
            safe: false,
            violations: ["Payload is null or undefined"],
            serializedSize: 0
        };
    }

    let serialized = "";
    try {
        serialized = typeof payload === "string" ? payload : JSON.stringify(payload);
    } catch (err) {
        return {
            safe: false,
            violations: [`Serialization failure: ${err.message}`],
            serializedSize: 0
        };
    }

    // 1. Canary String Scan
    if (Array.isArray(canaries) && canaries.length > 0) {
        for (const canary of canaries) {
            if (canary && typeof canary === "string" && serialized.includes(canary)) {
                violations.push("Canary leak detected: secret string is present in outbound payload");
            }
        }
    }

    // 2. Structural & Raw DOM Indicators
    for (const indicator of FORBIDDEN_STRUCTURAL_INDICATORS) {
        if (serialized.toLowerCase().includes(indicator.toLowerCase())) {
            violations.push(`Forbidden structural indicator detected: "${indicator}"`);
        }
    }

    // 3. Sensitive Keywords in Structured Payload
    let parsed = null;
    try {
        parsed = typeof payload === "object" && payload !== null ? payload : JSON.parse(serialized);
    } catch (_) {}

    if (parsed && typeof parsed === "object") {
        const goalStr = String(parsed.goal || parsed.command || "").toLowerCase();
        for (const kw of SENSITIVE_CONTROL_KEYWORDS) {
            const regex = new RegExp(`(^|[^a-z0-9])${kw}([^a-z0-9]|$)`, "i");
            if (regex.test(goalStr)) {
                violations.push(`Sensitive keyword "${kw}" detected in user goal`);
            }
        }

        const controls = Array.isArray(parsed.visible_controls)
            ? parsed.visible_controls
            : (Array.isArray(parsed.elements) ? parsed.elements : []);

        for (const ctrl of controls) {
            if (ctrl && ctrl.label) {
                const lbl = String(ctrl.label).toLowerCase();
                for (const kw of SENSITIVE_CONTROL_KEYWORDS) {
                    const regex = new RegExp(`(^|[^a-z0-9])${kw}([^a-z0-9]|$)`, "i");
                    if (regex.test(lbl)) {
                        violations.push(`Sensitive keyword "${kw}" detected in control label: "${ctrl.label}"`);
                    }
                }
            }
        }
    }

    // 4. Raw PII Scan on Serialized Content
    const detectedPII = detectPII(serialized);
    for (const finding of detectedPII) {
        violations.push(`Unredacted PII detected in serialized outbound payload: entity type "${finding.type}" (count: ${finding.count})`);
    }

    return {
        safe: violations.length === 0,
        violations,
        serializedSize: serialized.length
    };
}

function verifyOrBlock(payload, canaries = []) {
    const inspection = inspectOutboundPayload(payload, canaries);
    if (!inspection.safe) {
        return {
            allowed: false,
            reason: `Egress blocked by Privacy Gate: ${inspection.violations[0]}`,
            violations: inspection.violations
        };
    }
    return {
        allowed: true
    };
}


// ------------------------------------------------------------
// EXPORT
// ------------------------------------------------------------

globalThis.PrivAgentPrivacy = {
    PII_PATTERNS,
    sanitizeText,
    sanitizeUrl,
    sanitizePageState,
    sanitizeElements,
    detectPII,
    inspectOutboundPayload,
    verifyOrBlock
};

if (typeof module !== "undefined" && module.exports) {
    module.exports = {
        PrivAgentPrivacy: globalThis.PrivAgentPrivacy,
        PII_PATTERNS,
        sanitizeText,
        sanitizeUrl,
        sanitizePageState,
        sanitizeElements,
        detectPII,
        inspectOutboundPayload,
        verifyOrBlock
    };
}
