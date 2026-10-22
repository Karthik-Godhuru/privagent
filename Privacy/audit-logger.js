// ============================================================
// PRIVAGENT PRIVACY AUDIT LOGGER
// ============================================================

const MAX_AUDIT_LOGS = 200;
const inMemoryAuditStore = [];

/**
 * Sanitizes an event detail object so that NO raw canary, credential,
 * or raw sensitive value is logged in diagnostic or audit output.
 */
function sanitizeAuditDetails(details = {}) {
    const clean = {};
    const safeKeys = [
        "page_url",
        "action_taken",
        "status",
        "notes",
        "user_notified",
        "trigger_source",
        "count"
    ];

    for (const key of safeKeys) {
        if (details[key] !== undefined) {
            clean[key] = details[key];
        }
    }

    // Only copy entity TYPES (e.g. ['email', 'card']), never raw entity values!
    if (Array.isArray(details.detected_entities)) {
        clean.detected_entities = details.detected_entities.map(e => {
            if (typeof e === "string") return e;
            if (e && typeof e.type === "string") return e.type;
            return "unknown_entity";
        });
    } else {
        clean.detected_entities = [];
    }

    return clean;
}

/**
 * Records an immutable audit log entry for privacy events.
 *
 * Guarantees:
 * 1. Zero raw PII retention: only records entity types, timestamps, and outcomes.
 * 2. In-memory buffer capped at MAX_AUDIT_LOGS (FIFO eviction).
 * 3. Does not touch or overwrite existing on-disk Data/audit.json.
 *
 * @param {string} eventType - e.g. "sanitization", "pii_detected", "fail_closed_blocked", "egress_blocked"
 * @param {object} [details={}] - Contextual details (url, entity types, status).
 * @returns {object} - The recorded audit record.
 */
function logPrivacyEvent(eventType, details = {}) {
    const eventId = `audit_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const sanitizedMeta = sanitizeAuditDetails(details);

    const record = {
        event_id: eventId,
        timestamp: new Date().toISOString(),
        event_type: eventType,
        trigger_source: sanitizedMeta.trigger_source || "privacy_gate",
        detected_entities: sanitizedMeta.detected_entities,
        action_taken: sanitizedMeta.action_taken || "semantic_obfuscation",
        page_url: sanitizedMeta.page_url || "unknown",
        user_notified: Boolean(sanitizedMeta.user_notified),
        status: sanitizedMeta.status || "success",
        notes: sanitizedMeta.notes || ""
    };

    inMemoryAuditStore.push(record);

    if (inMemoryAuditStore.length > MAX_AUDIT_LOGS) {
        inMemoryAuditStore.shift();
    }

    return record;
}

/**
 * Returns a copy of the current audit event log.
 * @returns {object[]}
 */
function getAuditHistory() {
    return inMemoryAuditStore.map(entry => Object.assign({}, entry));
}

/**
 * Clears the in-memory audit store (useful for clean test isolation).
 */
function clearAuditHistory() {
    inMemoryAuditStore.length = 0;
}

module.exports = {
    logPrivacyEvent,
    getAuditHistory,
    clearAuditHistory
};
