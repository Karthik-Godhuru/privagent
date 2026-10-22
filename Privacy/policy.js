// ============================================================
// PRIVAGENT LOCAL PRIVACY POLICY ENFORCEMENT
// ============================================================

const { sanitizeText, sanitizeUrl } = require("./sanitizer");

const ALLOWED_TOP_FIELDS = new Set([
    "title",
    "url",
    "text",
    "elements",
    "role",
    "type",
    "label"
]);

const ALLOWED_ELEMENT_FIELDS = new Set([
    "id",
    "type",
    "subtype",
    "label",
    "selector",
    "enabled",
    "isSubmit"
]);

/**
 * Enforces structural privacy policy on captured page state:
 * 1. Rejects null, non-object or malformed page state (fail-closed).
 * 2. Filters out unexpected/prohibited top-level properties.
 * 3. Sanitizes page URL (strips sensitive query parameters).
 * 4. Applies in-memory text redaction to title, text, and element labels.
 *
 * @param {object} pageState - Raw or semi-structured page state.
 * @returns {{allowed: boolean, state?: object, reason?: string}}
 */
function applyPrivacyPolicy(pageState) {
    if (!pageState || typeof pageState !== "object" || Array.isArray(pageState)) {
        return {
            allowed: false,
            reason: "Invalid page state"
        };
    }

    const sanitizedState = {};

    for (const field of ALLOWED_TOP_FIELDS) {
        if (pageState[field] !== undefined) {
            sanitizedState[field] = pageState[field];
        }
    }

    // Apply URL sanitization (strip query parameters/tokens)
    if (typeof sanitizedState.url === "string") {
        sanitizedState.url = sanitizeUrl(sanitizedState.url);
    }

    // Apply text sanitization to title
    if (typeof sanitizedState.title === "string") {
        sanitizedState.title = sanitizeText(sanitizedState.title);
    }

    // Apply text sanitization to body text if present
    if (typeof sanitizedState.text === "string") {
        sanitizedState.text = sanitizeText(sanitizedState.text);
    }

    // Sanitize interactive elements if present
    if (Array.isArray(sanitizedState.elements)) {
        sanitizedState.elements = sanitizedState.elements.map(el => {
            if (!el || typeof el !== "object") {
                return null;
            }
            const cleanEl = {};
            for (const key of ALLOWED_ELEMENT_FIELDS) {
                if (el[key] !== undefined) {
                    cleanEl[key] = el[key];
                }
            }
            if (cleanEl.label) {
                cleanEl.label = sanitizeText(cleanEl.label);
            }
            return cleanEl;
        }).filter(Boolean);
    }

    return {
        allowed: true,
        state: sanitizedState
    };
}

module.exports = {
    ALLOWED_FIELDS: Array.from(ALLOWED_TOP_FIELDS),
    applyPrivacyPolicy
};
