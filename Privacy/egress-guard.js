// ============================================================
// PRIVAGENT OUTBOUND EGRESS GUARD & PAYLOAD INSPECTOR
// ============================================================

const { detectPII } = require("./detector");

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

/**
 * Rigorously inspects a candidate outbound network payload before serialization
 * and dispatch. Detects:
 * 1. Leakage of known synthetic canaries.
 * 2. Unredacted PII entities discovered by PII detector.
 * 3. Prohibited raw DOM / HTML / screenshot / pixel data.
 * 4. Sensitive credentials embedded in goal or control labels.
 *
 * @param {object|string} payload - Candidate outbound payload.
 * @param {string[]} [canaries=[]] - Known confidential canary strings to check.
 * @returns {{safe: boolean, violations: string[], serializedSize: number}}
 */
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
                violations.push(`Canary leak detected: secret string is present in outbound payload`);
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
            // Check word boundary or contextual keyword in goal
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

/**
 * Gatekeeper function: verifies payload or throws a descriptive fail-closed error.
 *
 * @param {object|string} payload - Candidate outbound payload.
 * @param {string[]} [canaries=[]] - Known confidential canary strings.
 * @returns {{allowed: boolean, reason?: string, violations?: string[]}}
 */
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

module.exports = {
    inspectOutboundPayload,
    verifyOrBlock
};
