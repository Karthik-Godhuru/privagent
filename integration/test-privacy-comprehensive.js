// ============================================================
// PRIVAGENT — COMPREHENSIVE PRIVACY & EGRESS VERIFICATION SUITE
//
// Tests:
// 1. Strengthened PII & Credential Detection (Phone, A/C, Email, Passwords, OTP, Tokens, IBAN, SSN)
// 2. Unicode NFKC Normalization & Homoglyph Resilience
// 3. Encoded Query Parameter & URL Sanitization
// 4. False-Positive Resistance & Context Preservation
// 5. Idempotence & Input Edge Cases (null, undefined, malformed, empty)
// 6. Serialized Outbound Egress Guard & Canary Exclusion Audit
// 7. Multi-Step History Value Sanitization
// 8. Privacy Audit Logging & Zero-Leakage Guarantee
//
// Run with: node integration/test-privacy-comprehensive.js
// ============================================================

const { PII_PATTERNS } = require("../Privacy/pii-patterns");
const { detectPII } = require("../Privacy/detector");
const { sanitizeText, sanitizeUrl } = require("../Privacy/sanitizer");
const { applyPrivacyPolicy } = require("../Privacy/policy");
const { inspectOutboundPayload, verifyOrBlock } = require("../Privacy/egress-guard");
const { logPrivacyEvent, getAuditHistory, clearAuditHistory } = require("../Privacy/audit-logger");
const { PrivAgentPrivacy } = require("../extension/privacy-gate");

let passed = 0;
let failed = 0;

function check(description, condition, details = "") {
    if (condition) {
        console.log(`  ✓  ${description}`);
        passed++;
    } else {
        console.error(`  ✗  ${description}`);
        if (details) console.error(`       ${details}`);
        failed++;
    }
}

console.log("\n============================================================");
console.log(" PRIVAGENT COMPREHENSIVE PRIVACY & QA REGRESSION SUITE");
console.log("============================================================\n");

// ------------------------------------------------------------
// 1. STRENGTHENED DETECTION & SANITIZATION MATRIX
// ------------------------------------------------------------
console.log("--- 1. Strengthened PII & Credential Sanitization ---");

// A. International & US Phone Numbers
const intlPhone = "Call customer service at +1 (555) 234-5678 or 555-876-5432.";
const sanitizedIntlPhone = sanitizeText(intlPhone);
check("US/Intl phone (delimited) is redacted", !sanitizedIntlPhone.includes("234-5678") && sanitizedIntlPhone.includes("[PHONE_REDACTED]"));

// B. Contextual Passwords
const rawPassword = "Login details: username: user123, password: SuperSecretCanary999!";
const sanitizedPassword = sanitizeText(rawPassword);
check("Contextual password value is redacted", !sanitizedPassword.includes("SuperSecretCanary999!") && sanitizedPassword.includes("[PASSWORD_REDACTED]"));
check("Username label is preserved", sanitizedPassword.includes("username: user123"));

// C. Bearer Tokens & Authorization Credentials
const rawBearer = "Authorization header: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.token123456";
const sanitizedBearer = sanitizeText(rawBearer);
check("Bearer token is redacted", !sanitizedBearer.includes("token123456") && sanitizedBearer.includes("[BEARER_TOKEN_REDACTED]"));

// D. Contextual API Keys
const rawApiKey = "Configure service with api_key: AIzaSySyntheticTestKey9876543210";
const sanitizedApiKey = sanitizeText(rawApiKey);
check("API key credential is redacted", !sanitizedApiKey.includes("AIzaSySyntheticTestKey9876543210") && sanitizedApiKey.includes("[AUTH_CREDENTIAL_REDACTED]"));

// E. International Bank Account Number (IBAN)
const rawIban = "Beneficiary IBAN: GB82 WEST 1234 5698 7654 32 for wire transfer";
const sanitizedIban = sanitizeText(rawIban);
check("IBAN identifier is redacted", !sanitizedIban.includes("1234 5698 7654 32") && sanitizedIban.includes("[IBAN_REDACTED]"));

// F. US Social Security Number (SSN)
const rawSsn = "Taxpayer identifier: 123-45-6789 on record";
const sanitizedSsn = sanitizeText(rawSsn);
check("US SSN format is redacted", !sanitizedSsn.includes("123-45-6789") && sanitizedSsn.includes("[SSN_REDACTED]"));

// G. Indian Bank Account Numbers
const rawAccount = "Transfer from A/C No: 987654321098 to Acc: 112233445566";
const sanitizedAccount = sanitizeText(rawAccount);
check("Bank account numbers are redacted", !sanitizedAccount.includes("987654321098") && !sanitizedAccount.includes("112233445566") && sanitizedAccount.includes("[ACCOUNT_REDACTED]"));

// H. Contextual OTP & PIN
const rawOtp = "Your verification code: 849201 and debit PIN: 4321";
const sanitizedOtp = sanitizeText(rawOtp);
check("OTP and PIN are redacted", !sanitizedOtp.includes("849201") && !sanitizedOtp.includes("4321") && sanitizedOtp.includes("[OTP_REDACTED]"));


// ------------------------------------------------------------
// 2. UNICODE NORMALIZATION & HOMOGLYPH RESILIENCE
// ------------------------------------------------------------
console.log("\n--- 2. Unicode Normalization & Homoglyph Resilience ---");

// Fullwidth Latin email: ｕｓｅｒ＠ｅｘａｍｐｌｅ．ｃｏｍ
const fullwidthEmail = "\uff55\uff53\uff45\uff52\uff20\uff45\uff58\uff41\uff4d\uff50\uff4c\uff45\uff0e\uff43\uff4f\uff4d";
const sanitizedFullwidth = sanitizeText(fullwidthEmail);
check("Fullwidth Unicode email normalized and redacted", sanitizedFullwidth.includes("[EMAIL_REDACTED]") && !sanitizedFullwidth.includes("\uff55\uff53\uff45\uff52"));

// Fullwidth Digits Phone: ９８７６５４３２１０
const fullwidthPhone = "\uff19\uff18\uff17\uff16\uff15\uff14\uff13\uff12\uff11\uff10";
const sanitizedFullwidthPhone = sanitizeText(fullwidthPhone);
check("Fullwidth Unicode phone normalized and redacted", sanitizedFullwidthPhone.includes("[PHONE_REDACTED]"));


// ------------------------------------------------------------
// 3. URL SANITIZATION & ENCODED QUERY PARAMETERS
// ------------------------------------------------------------
console.log("\n--- 3. URL Sanitization & Query Parameter Stripping ---");

const dirtyUrl1 = "https://bank.example.com/portal/dashboard?token=CANARY_JWT_SECRET_123&session=abc987#user-view";
check("URL query parameters and hash stripped", sanitizeUrl(dirtyUrl1) === "https://bank.example.com/portal/dashboard");

const dirtyUrl2 = "https://checkout.example.com/pay?redirect=%2Faccount%3Fkey%3DCANARY_SECRET";
check("Percent-encoded query parameter stripped", sanitizeUrl(dirtyUrl2) === "https://checkout.example.com/pay");

const relativeUrl = "/banking/statement?auth=SECRET_TOKEN_XYZ";
check("Relative URL query parameters stripped", sanitizeUrl(relativeUrl) === "/banking/statement");

const emptyUrl = sanitizeUrl("");
check("Empty URL handled gracefully without exception", emptyUrl === "");


// ------------------------------------------------------------
// 4. FALSE-POSITIVE RESISTANCE & CONTEXT PRESERVATION
// ------------------------------------------------------------
console.log("\n--- 4. False-Positive Resistance & Context Preservation ---");

const safeText = "Order #1029384756 | Product: Galaxy Book4 Pro | Price: ₹85,000 | Discount: 20% | Date: 2026-10-22";
const sanitizedSafe = sanitizeText(safeText);

check("10-digit order number starting with 1 preserved (not Aadhaar)", sanitizedSafe.includes("1029384756"));
check("Product model name preserved", sanitizedSafe.includes("Galaxy Book4 Pro"));
check("Currency and price preserved", sanitizedSafe.includes("₹85,000"));
check("Percentage value preserved", sanitizedSafe.includes("20%"));
check("ISO date format preserved", sanitizedSafe.includes("2026-10-22"));


// ------------------------------------------------------------
// 5. IDEMPOTENCE & INPUT EDGE CASES
// ------------------------------------------------------------
console.log("\n--- 5. Idempotence & Input Edge Cases ---");

const mixedDirty = "User karthik@example.com paid via UPI karthik@okhdfcbank with card 4532 0151 1283 0366";
const pass1 = sanitizeText(mixedDirty);
const pass2 = sanitizeText(pass1);
const pass3 = sanitizeText(pass2);

check("Sanitization is idempotent (pass 1 equals pass 2)", pass1 === pass2);
check("Sanitization is idempotent (pass 2 equals pass 3)", pass2 === pass3);
check("No nested or corrupted token brackets", !pass2.includes("[[") && !pass2.includes("]]"));

// Edge case inputs
check("null input returns empty string", sanitizeText(null) === "");
check("undefined input returns empty string", sanitizeText(undefined) === "");
check("numeric input handled safely", sanitizeText(12345) === "12345");
check("detectPII on null returns empty array", detectPII(null).length === 0);
check("detectPII on empty string returns empty array", detectPII("").length === 0);
check("applyPrivacyPolicy on null fails closed", applyPrivacyPolicy(null).allowed === false);


// ------------------------------------------------------------
// 6. POLICY ENFORCEMENT ON STRUCTURED PAGE STATE
// ------------------------------------------------------------
console.log("\n--- 6. Deep Privacy Policy Enforcement ---");

const rawPageState = {
    title: "Secure Portal - user@example.com",
    url: "https://bank.example.com/statement?session=SECRET_SESSION_TOKEN",
    text: "Your current balance is visible below.",
    forbiddenInternalProperty: "PROHIBITED_METADATA",
    elements: [
        { id: "btn-1", type: "button", label: "View Statement", selector: "#statementButton", enabled: true, internalSecret: "DO_NOT_LEAK" },
        { id: "inp-1", type: "input", label: "Card Number 4532 0151 1283 0366", selector: "#cardInput", enabled: true }
    ]
};

const policyOutcome = applyPrivacyPolicy(rawPageState);

check("Policy allows sanitized page state", policyOutcome.allowed === true);
check("Prohibited top-level property stripped", policyOutcome.state.forbiddenInternalProperty === undefined);
check("URL stripped of session token", policyOutcome.state.url === "https://bank.example.com/statement");
check("Title email redacted", policyOutcome.state.title.includes("[EMAIL_REDACTED]") && !policyOutcome.state.title.includes("user@example.com"));
check("Element label card number redacted", policyOutcome.state.elements[1].label.includes("[CARD_REDACTED]"));
check("Element internal secret stripped", policyOutcome.state.elements[0].internalSecret === undefined);


// ------------------------------------------------------------
// 7. SERIALIZED OUTBOUND EGRESS GUARD & CANARY AUDIT
// ------------------------------------------------------------
console.log("\n--- 7. Serialized Outbound Egress Guard & Canary Audit ---");

const CANARIES = [
    "CANARY_PASSWORD_SECRET_999",
    "CANARY_BEARER_TOKEN_XYZ_123456",
    "CANARY_OTP_748291",
    "4532 0151 1283 0366",
    "GB82 WEST 1234 5698 7654 32",
    "123-45-6789",
    "karthik.canary@confidential.example.com",
    "canary.merchant@okhdfcbank"
];

// Clean Outbound Context
const cleanOutbound = {
    goal: "click view statement",
    visible_controls: [
        { type: "button", label: "View Statement", selector: "#statementButton", enabled: true }
    ],
    safe_labels: [
        { text: "Secure Portal", role: "page_title", selector: null }
    ]
};

const cleanInspection = inspectOutboundPayload(cleanOutbound, CANARIES);
check("Clean outbound payload passes egress inspection", cleanInspection.safe === true && cleanInspection.violations.length === 0);

// Dirty Outbound Context containing Canary Leak
const dirtyOutboundWithCanary = {
    goal: "transfer funds",
    visible_controls: [
        { type: "button", label: `Pay ${CANARIES[0]}`, selector: "#btn" }
    ]
};

const dirtyInspection = inspectOutboundPayload(dirtyOutboundWithCanary, CANARIES);
check("Outbound payload with canary leak detected and flagged", dirtyInspection.safe === false);
check("Egress guard verifyOrBlock halts transmission", verifyOrBlock(dirtyOutboundWithCanary, CANARIES).allowed === false);

// Dirty Outbound Context containing Forbidden Structural Data
const dirtyOutboundWithDOM = {
    goal: "analyze page",
    raw_dom: "<script>alert(1)</script>",
    text: "document.body.innerText"
};

const domInspection = inspectOutboundPayload(dirtyOutboundWithDOM);
check("Outbound payload with forbidden structural DOM is blocked", domInspection.safe === false);


// ------------------------------------------------------------
// 8. MULTI-STEP HISTORY VALUE SANITIZATION
// ------------------------------------------------------------
console.log("\n--- 8. Multi-Step History Value Sanitization ---");

const multiStepHistory = [
    { step: 1, action: { action: "type", selector: "#search", value: "laptop" } },
    { step: 2, action: { action: "type", selector: "#card", value: "4532 0151 1283 0366" } },
    { step: 3, action: { action: "type", selector: "#otp", value: "OTP: 928103" } }
];

// Sanitize history action values before context dispatch
const sanitizedHistory = multiStepHistory.map(h => ({
    step: h.step,
    action: Object.assign({}, h.action, {
        value: h.action.value ? sanitizeText(h.action.value) : h.action.value
    })
}));

check("History step 1 harmless value preserved", sanitizedHistory[0].action.value === "laptop");
check("History step 2 card value sanitized", !sanitizedHistory[1].action.value.includes("4532 0151 1283 0366") && sanitizedHistory[1].action.value.includes("[CARD_REDACTED]"));
check("History step 3 OTP value sanitized", !sanitizedHistory[2].action.value.includes("928103") && sanitizedHistory[2].action.value.includes("[OTP_REDACTED]"));


// ------------------------------------------------------------
// 9. PRIVACY AUDIT LOGGING & ZERO-LEAKAGE GUARANTEE
// ------------------------------------------------------------
console.log("\n--- 9. Privacy Audit Logging & Zero-Leakage Guarantee ---");

clearAuditHistory();

logPrivacyEvent("sanitization", {
    page_url: "https://bank.example.com/checkout",
    detected_entities: ["card", "email", "otp"],
    action_taken: "semantic_obfuscation",
    status: "success"
});

logPrivacyEvent("egress_blocked", {
    page_url: "https://bank.example.com/pay",
    detected_entities: ["bearer"],
    action_taken: "blocked_network_io",
    status: "blocked",
    notes: "Attempted transmission of authorization bearer token"
});

const auditEvents = getAuditHistory();
check("Exactly 2 audit events recorded in memory", auditEvents.length === 2);
check("First audit event has event_id", Boolean(auditEvents[0].event_id));
check("First audit event records detected entity types", auditEvents[0].detected_entities.includes("card") && auditEvents[0].detected_entities.includes("email"));
check("Second audit event records blocked status", auditEvents[1].status === "blocked");

// Serialized audit log leak check
const auditJson = JSON.stringify(auditEvents);
let canaryAuditLeak = false;
for (const canary of CANARIES) {
    if (auditJson.includes(canary)) {
        canaryAuditLeak = true;
    }
}
check("Zero canaries or secrets present in audit logs", canaryAuditLeak === false);


// ------------------------------------------------------------
// 10. REPO PARITY: Privacy/ vs extension/privacy-gate.js
// ------------------------------------------------------------
console.log("\n--- 10. Parity Verification: Privacy/ and extension/privacy-gate.js ---");

const testMixedPayload = "Email: user@example.com, UPI: user@okhdfcbank, SSN: 123-45-6789, IBAN: GB82 WEST 1234 5698 7654 32, Card: 4532 0151 1283 0366";

const nodeSanitized = sanitizeText(testMixedPayload);
const extensionSanitized = PrivAgentPrivacy.sanitizeText(testMixedPayload);

check("Both modules redact Email identically", nodeSanitized.includes("[EMAIL_REDACTED]") && extensionSanitized.includes("[EMAIL_REDACTED]"));
check("Both modules redact UPI identically", nodeSanitized.includes("[UPI_REDACTED]") && extensionSanitized.includes("[UPI_REDACTED]"));
check("Both modules redact SSN identically", nodeSanitized.includes("[SSN_REDACTED]") && extensionSanitized.includes("[SSN_REDACTED]"));
check("Both modules redact IBAN identically", nodeSanitized.includes("[IBAN_REDACTED]") && extensionSanitized.includes("[IBAN_REDACTED]"));
check("Both modules redact Card identically", nodeSanitized.includes("[CARD_REDACTED]") && extensionSanitized.includes("[CARD_REDACTED]"));
check("Both outputs are strictly equal", nodeSanitized === extensionSanitized);


// ============================================================
// TEST SUMMARY
// ============================================================
console.log("\n============================================================");
console.log(` RESULTS: ${passed} passed, ${failed} failed`);
console.log("============================================================\n");

if (failed > 0) {
    process.exit(1);
}
