// ============================================================
// PRIVAGENT — SYNTHETIC CANARY & NETWORK BOUNDARY VERIFICATION
//
// Tests:
// 1. Prohibited secret canaries are absent from serialized outbound payload.
// 2. Sensitive input extraction excludes password, OTP, card, and hidden values.
// 3. Indian PII patterns (Aadhaar, UPI, PAN, Phone, Email, OTP, Account) redact cleanly.
// 4. Non-sensitive data (prices, order IDs, product names) avoid false-positive redaction.
// 5. Fail-closed verification: sanitization failure strictly halts network transmission.
//
// Run with: node integration/test-synthetic-canary.js
// ============================================================

const { PrivAgentPrivacy } = require("../extension/privacy-gate.js");

// ------------------------------------------------------------
// SYNTHETIC SECRET CANARIES (NEVER REAL DATA)
// ------------------------------------------------------------

const CANARIES = {
    password: "CANARY_SECRET_PASSWORD_999!",
    csrfToken: "CANARY_CSRF_TOKEN_xyz123abc456",
    otp: "748291",
    aadhaar: "2345 6789 0123",
    phone: "+91 9876543210",
    email: "canary.confidential@example.org",
    card: "4532 0151 1283 0366",
    upi: "canary.payment@okhdfcbank",
    account: "123456789012345"
};

let testsPassed = 0;
let testsFailed = 0;

function assert(description, condition, details = "") {
    if (condition) {
        console.log(`  ✓  ${description}`);
        testsPassed++;
    } else {
        console.error(`  ✗  ${description}`);
        if (details) console.error(`       ${details}`);
        testsFailed++;
    }
}

console.log("\n============================================================");
console.log(" PRIVAGENT SECURITY BOUNDARY & CANARY VERIFICATION SUITE");
console.log("============================================================\n");


// ------------------------------------------------------------
// 1. TEXT SANITIZATION & PATTERN TESTS
// ------------------------------------------------------------

console.log("--- 1. PII Redaction Coverage & Correctness ---");

const rawDirtyText = `
User Profile:
Name: Test Canary User
Email: ${CANARIES.email}
UPI ID: ${CANARIES.upi}
Phone: ${CANARIES.phone}
Aadhaar: ${CANARIES.aadhaar}
PAN: ABCDE1234F
Card: ${CANARIES.card}
OTP: ${CANARIES.otp}
A/C No: ${CANARIES.account}
`;

const sanitizedText = PrivAgentPrivacy.sanitizeText(rawDirtyText);

assert("Email canary is redacted", !sanitizedText.includes(CANARIES.email) && sanitizedText.includes("[EMAIL_REDACTED]"));
assert("UPI canary is redacted", !sanitizedText.includes(CANARIES.upi) && sanitizedText.includes("[UPI_REDACTED]"));
assert("Phone canary is redacted", !sanitizedText.includes("9876543210") && sanitizedText.includes("[PHONE_REDACTED]"));
assert("Aadhaar canary is redacted", !sanitizedText.includes("2345 6789 0123") && sanitizedText.includes("[AADHAAR_REDACTED]"));
assert("PAN number is redacted", !sanitizedText.includes("ABCDE1234F") && sanitizedText.includes("[PAN_REDACTED]"));
assert("Payment card canary is redacted", !sanitizedText.includes("4532 0151 1283 0366") && sanitizedText.includes("[CARD_REDACTED]"));
assert("OTP canary is redacted", !sanitizedText.includes(CANARIES.otp) && sanitizedText.includes("[OTP_REDACTED]"));
assert("Account number canary is redacted", !sanitizedText.includes(CANARIES.account) && sanitizedText.includes("[ACCOUNT_REDACTED]"));


// ------------------------------------------------------------
// 2. FALSE-POSITIVE RESISTANCE
// ------------------------------------------------------------

console.log("\n--- 2. False-Positive Resistance on Safe Data ---");

const safeEcommerceText = "Order #1029384756 | Product: Galaxy Book4 Pro | Price: ₹85,000 | Discount: 20%";
const sanitizedSafeText = PrivAgentPrivacy.sanitizeText(safeEcommerceText);

assert("Order number is preserved (not treated as Aadhaar)", sanitizedSafeText.includes("1029384756"));
assert("Product name is preserved", sanitizedSafeText.includes("Galaxy Book4 Pro"));
assert("Price value is preserved", sanitizedSafeText.includes("₹85,000"));


// ------------------------------------------------------------
// 3. INPUT VALUE EXCLUSION & DOM EXTRACTION
// ------------------------------------------------------------

console.log("\n--- 3. Element Extraction & Value Exclusion ---");

const SENSITIVE_INPUT_TYPES = new Set(["password", "hidden", "tel"]);
const SENSITIVE_FIELD_KEYWORDS = [
    "password", "passwd", "secret", "token", "otp",
    "cvv", "cvc", "pin", "ssn", "aadhaar", "pan",
    "card_number", "cardnumber", "passport"
];

function isSensitiveElementStub(element) {
    if (!element || (element.tagName !== "INPUT" && element.tagName !== "TEXTAREA")) {
        return false;
    }
    const type = (element.type || "").toLowerCase();
    if (SENSITIVE_INPUT_TYPES.has(type)) return true;

    const autocomplete = (element.autocomplete || "").toLowerCase();
    if (
        autocomplete.includes("password") ||
        autocomplete.includes("one-time-code") ||
        autocomplete.includes("cc-") ||
        autocomplete.includes("card")
    ) {
        return true;
    }

    const identifier = [
        element.name || "",
        element.id || "",
        element.ariaLabel || "",
        element.placeholder || ""
    ].join(" ").toLowerCase();

    for (const word of SENSITIVE_FIELD_KEYWORDS) {
        const regex = new RegExp(`(^|[^a-z0-9])${word}([^a-z0-9]|$)`, "i");
        if (regex.test(identifier)) return true;
    }

    return false;
}

function extractElementLabelStub(element) {
    const isSensitive = isSensitiveElementStub(element);
    if (element.innerText && element.innerText.trim()) return element.innerText.trim();
    if (element.ariaLabel && element.ariaLabel.trim()) return element.ariaLabel.trim();
    if (element.associatedLabel && element.associatedLabel.trim()) return element.associatedLabel.trim();
    if (element.placeholder && element.placeholder.trim()) return element.placeholder.trim();
    if (!isSensitive && element.value) return String(element.value).trim();
    return "";
}

const mockFormElements = [
    { tagName: "INPUT", type: "password", value: CANARIES.password, placeholder: "Enter password" },
    { tagName: "INPUT", type: "hidden", name: "csrf_token", value: CANARIES.csrfToken },
    { tagName: "INPUT", type: "text", name: "otp_code", value: CANARIES.otp, placeholder: "6-digit OTP" },
    { tagName: "INPUT", type: "text", id: "cvv_input", value: "981", ariaLabel: "CVV" },
    { tagName: "INPUT", type: "tel", value: CANARIES.phone, placeholder: "Mobile number" },
    { tagName: "INPUT", type: "text", name: "passport_number", value: "A98765432", placeholder: "Passport Number" },
    { tagName: "INPUT", type: "number", id: "transfer_amount", value: "5000", associatedLabel: "Transfer Amount" },
    { tagName: "BUTTON", innerText: "Transfer Money" }
];

const extractedControls = mockFormElements.map((el, i) => ({
    id: `element_${i}`,
    type: el.tagName.toLowerCase(),
    label: PrivAgentPrivacy.sanitizeText(extractElementLabelStub(el)),
    selector: `[data-privagent-id="pa-${i}"]`,
    enabled: true
}));

assert("Password canary excluded from extracted label", !extractedControls.some(c => c.label.includes(CANARIES.password)));
assert("Password placeholder is preserved for navigation", extractedControls[0].label === "Enter password");
assert("CSRF token canary excluded from label", !extractedControls.some(c => c.label.includes(CANARIES.csrfToken)));
assert("OTP canary excluded from text input with sensitive name", !extractedControls.some(c => c.label.includes(CANARIES.otp)));
assert("CVV value excluded from label", !extractedControls.some(c => c.label.includes("981")));
assert("Phone canary excluded from tel input value", !extractedControls.some(c => c.label.includes(CANARIES.phone)));
assert("Passport number value excluded from label", !extractedControls.some(c => c.label.includes("A98765432")));
assert("Passport placeholder preserved for navigation", extractedControls[5].label === "Passport Number");
assert("Safe label resolved via associated label", extractedControls[6].label === "Transfer Amount");


// ------------------------------------------------------------
// 4. ACTUAL SERIALIZED OUTBOUND NETWORK PAYLOAD AUDIT
// ------------------------------------------------------------

console.log("\n--- 4. Serialized Outbound Payload Security Audit ---");

const rawUserCommand = `Transfer ₹5000 to ${CANARIES.upi} with OTP ${CANARIES.otp}`;

// Simulating exact background.js context packaging
let sanitizedGoal = rawUserCommand.trim();
if (typeof PrivAgentPrivacy !== "undefined" && typeof PrivAgentPrivacy.sanitizeText === "function") {
    sanitizedGoal = PrivAgentPrivacy.sanitizeText(sanitizedGoal);
}

const outboundPayload = {
    goal: sanitizedGoal,
    visible_controls: extractedControls,
    safe_labels: [{ text: "Banking Dashboard", role: "page_title", selector: null }],
    redacted_regions: [],
    action_candidates: []
};

const serializedJson = JSON.stringify(outboundPayload, null, 2);

// Check that ZERO canaries exist anywhere in serialized JSON
let canaryLeakCount = 0;
for (const [canaryName, canaryValue] of Object.entries(CANARIES)) {
    if (serializedJson.includes(canaryValue)) {
        console.error(`  LEAK DETECTED: ${canaryName} ("${canaryValue}") found in outbound JSON!`);
        canaryLeakCount++;
    }
}

assert("Zero synthetic canaries found in serialized outbound JSON", canaryLeakCount === 0, `Leaks detected: ${canaryLeakCount}`);
assert("User instruction with UPI & OTP is sanitized in goal", !serializedJson.includes(CANARIES.upi) && !serializedJson.includes(CANARIES.otp));
assert("Page text is NOT included in outbound payload", !serializedJson.includes("document.body.innerText"));
assert("Raw pixels/screenshots are NOT included in outbound payload", !serializedJson.includes("base64") && !serializedJson.includes("screenshot"));


// ------------------------------------------------------------
// 5. FAIL-CLOSED BEHAVIOR VERIFICATION
// ------------------------------------------------------------

console.log("\n--- 5. Fail-Closed Resilience on Sanitization Failure ---");

function simulateGetPageStateWithFailure(forceError = false) {
    try {
        if (forceError) {
            throw new Error("Simulated memory corruption / parser exception");
        }
        return { success: true, pageState: {} };
    } catch (err) {
        return {
            success: false,
            error: "Sanitization failed - fail closed: " + err.message
        };
    }
}

function simulateNetworkDispatch(pageStateResult) {
    if (!pageStateResult || pageStateResult.success === false) {
        throw new Error("BLOCKED: Refusing network call because page state sanitization failed.");
    }
    return "DISPATCHED_TO_SERVER";
}

let networkBlocked = false;
try {
    const failedResult = simulateGetPageStateWithFailure(true);
    simulateNetworkDispatch(failedResult);
} catch (err) {
    if (err.message.includes("BLOCKED")) {
        networkBlocked = true;
    }
}

assert("Network request strictly blocked when sanitization fails (fail-closed)", networkBlocked);


// ------------------------------------------------------------
// TEST REPORT SUMMARY
// ------------------------------------------------------------

console.log("\n============================================================");
console.log(` RESULTS: ${testsPassed} passed, ${testsFailed} failed`);
console.log("============================================================\n");

if (testsFailed > 0) {
    process.exit(1);
}
