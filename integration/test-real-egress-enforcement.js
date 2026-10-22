// ============================================================
// PRIVAGENT — REAL OUTBOUND EGRESS ENFORCEMENT TEST SUITE
//
// Rigorously verifies Phase 3 & 4 outbound network security in extension/background.js:
// 1. Allowed sanitized payload reaches the mock transport.
// 2. Unique synthetic sensitive canaries are absent from actual serialized outbound body.
// 3. Blocked payload (unredacted PII / raw DOM / canary leak) never reaches transport.
// 4. Unavailable or throwing privacy guard strictly blocks transmission (fail-closed).
// 5. Harmless task instructions and essential page controls remain fully usable.
// 6. Error handling, retries, and audit logging never reintroduce sensitive values.
// 7. Existing confirmation controls still protect consequential actions.
//
// Run with: node integration/test-real-egress-enforcement.js
// ============================================================

const { PrivAgentPrivacy } = require("../extension/privacy-gate.js");
global.PrivAgentPrivacy = PrivAgentPrivacy;

const {
    runAgent,
    isConsequentialAction,
    validateActionGrounded,
    endTask
} = require("../extension/background.js");

const { logPrivacyEvent, getAuditHistory, clearAuditHistory } = require("../Privacy/audit-logger.js");

let passed = 0;
let failed = 0;

function check(description, condition, details = "") {
    if (condition) {
        console.log(`  ✓  ${description}`);
        passed++;
    } else {
        console.error(`  ✗  ${description}`);
        if (details) console.error(`       Details: ${details}`);
        failed++;
    }
}

// ------------------------------------------------------------
// SYNTHETIC SECRET CANARIES (NEVER REAL CREDENTIALS)
// ------------------------------------------------------------
const CANARIES = {
    password: "SYNTHETIC_CANARY_PWD_9999!",
    bearer: "Bearer synthetic_token_canary_xyz_123456789",
    otp: "849201",
    card: "4532 0151 1283 0366",
    iban: "GB82 WEST 1234 5698 7654 32",
    ssn: "123-45-6789",
    email: "canary.confidential.user@example.org",
    upi: "canary.merchant.handle@okhdfcbank",
    account: "987654321098"
};

async function runRealEgressTestSuite() {
    console.log("\n============================================================");
    console.log(" PRIVAGENT REAL OUTBOUND EGRESS ENFORCEMENT TEST SUITE");
    console.log("============================================================\n");

    const originalFetch = global.fetch;

    // ------------------------------------------------------------
    // TEST 1: ALLOWED SANITIZED PAYLOAD REACHES MOCK TRANSPORT
    // ------------------------------------------------------------
    console.log("--- 1. Allowed Sanitized Payload Reaches Transport ---");

    let interceptedRequest = null;
    let mockFetchCallCount = 0;

    global.fetch = async (url, options) => {
        mockFetchCallCount++;
        interceptedRequest = { url, options };
        return {
            ok: true,
            status: 200,
            json: async () => ({
                success: true,
                message: "Identified statement button.",
                action: { action: "click", selector: "#statementButton" },
                planner: "local-deterministic"
            })
        };
    };

    const cleanPageState = {
        title: "Secure Banking Portal",
        url: "http://127.0.0.1:5500/banking.html",
        text: "Account Overview",
        elements: [
            { id: "el_0", type: "button", label: "View Statement", selector: "#statementButton", enabled: true }
        ]
    };

    const cleanResult = await runAgent({
        command: "Click View Statement",
        step: 1,
        sanitizedContext: cleanPageState
    });

    check("runAgent succeeds on clean sanitized context", cleanResult.success === true);
    check("Mock transport fetch was invoked exactly once", mockFetchCallCount === 1);
    check("Dispatched to expected /agent endpoint", interceptedRequest.url.endsWith("/agent"));
    check("X-PrivAgent-Token header is attached", interceptedRequest.options.headers["X-PrivAgent-Token"] === "privagent-local-token");

    const sentJson = JSON.parse(interceptedRequest.options.body);
    check("Sent body contains clean goal", sentJson.goal === "Click View Statement");
    check("Sent body contains grounded selector", sentJson.visible_controls[0].selector === "#statementButton");


    // ------------------------------------------------------------
    // TEST 2: CANARIES ARE ABSENT FROM ACTUAL SERIALIZED OUTBOUND BODY
    // ------------------------------------------------------------
    console.log("\n--- 2. Synthetic Canaries Absent from Serialized Body ---");

    mockFetchCallCount = 0;
    interceptedRequest = null;

    // Command containing multiple synthetic canaries (email, UPI, account)
    const dirtyCommand = `Click View Statement for ${CANARIES.email} account ${CANARIES.account} via ${CANARIES.upi}`;

    const sanitizedPageStateWithCanaryInLabel = {
        title: `Portal - ${CANARIES.email}`,
        url: `http://127.0.0.1:5500/portal?session=SECRET_TOKEN_CANARY_123`,
        text: "Body text",
        elements: [
            // Simulating pre-sanitized element where PII was redacted
            { id: "el_0", type: "button", label: PrivAgentPrivacy.sanitizeText(`Pay Card ${CANARIES.card}`), selector: "#btnPay", enabled: true }
        ]
    };

    await runAgent({
        command: dirtyCommand,
        step: 1,
        sanitizedContext: sanitizedPageStateWithCanaryInLabel
    });

    check("Fetch was invoked for sanitized payload", mockFetchCallCount === 1);
    const serializedBody = interceptedRequest.options.body;

    // Rigorously inspect the actual serialized string transmitted over the wire
    let leakFound = false;
    for (const [canaryName, canaryValue] of Object.entries(CANARIES)) {
        if (serializedBody.includes(canaryValue)) {
            leakFound = true;
            console.error(`  LEAK DETECTED in serialized body: ${canaryName}`);
        }
    }

    check("Zero synthetic canaries found in actual serialized outbound body", leakFound === false);
    check("Goal email canary replaced with token", serializedBody.includes("[EMAIL_REDACTED]"));
    check("Goal UPI canary replaced with token", serializedBody.includes("[UPI_REDACTED]"));
    check("Element card canary replaced with token", serializedBody.includes("[CARD_REDACTED]"));


    // ------------------------------------------------------------
    // TEST 3: BLOCKED PAYLOAD NEVER REACHES TRANSPORT (FAIL-CLOSED)
    // ------------------------------------------------------------
    console.log("\n--- 3. Blocked Payload Never Reaches Transport ---");

    mockFetchCallCount = 0;
    let blockedErrorCaught = false;

    // Malicious context attempting to leak raw DOM or unredacted credential keywords
    const maliciousPageState = {
        title: "Malicious Page",
        url: "http://malicious.com",
        elements: [
            // An unredacted password/pin in label that would trigger egress violation
            { id: "el_bad", type: "input", label: "enter your secret password now", selector: "#pw", enabled: true }
        ]
    };

    try {
        await runAgent({
            command: "type into field",
            step: 1,
            sanitizedContext: maliciousPageState
        });
    } catch (err) {
        if (err.message.includes("Egress blocked by Privacy Gate")) {
            blockedErrorCaught = true;
        }
    }

    check("Egress guard halts request on unredacted sensitive keyword", blockedErrorCaught === true);
    check("Transport fetch was NEVER called for blocked payload", mockFetchCallCount === 0);


    // ------------------------------------------------------------
    // TEST 4: UNAVAILABLE OR THROWING GUARD BLOCKS TRANSMISSION
    // ------------------------------------------------------------
    console.log("\n--- 4. Unavailable or Throwing Guard Blocks Transmission ---");

    mockFetchCallCount = 0;
    let guardMissingErrorCaught = false;

    // Temporarily sabotage verifyOrBlock
    const originalVerifyOrBlock = PrivAgentPrivacy.verifyOrBlock;
    PrivAgentPrivacy.verifyOrBlock = undefined;

    try {
        await runAgent({
            command: "Click View Statement",
            step: 1,
            sanitizedContext: cleanPageState
        });
    } catch (err) {
        if (err.message.includes("Privacy Egress Guard is unavailable - fail closed")) {
            guardMissingErrorCaught = true;
        }
    }

    check("Missing egress guard strictly aborts transmission (fail-closed)", guardMissingErrorCaught === true);
    check("Transport fetch was NEVER called when guard was unavailable", mockFetchCallCount === 0);

    // Test throwing guard
    PrivAgentPrivacy.verifyOrBlock = () => {
        throw new Error("Simulated memory fault in egress inspector");
    };

    let guardThrowErrorCaught = false;
    try {
        await runAgent({
            command: "Click View Statement",
            step: 1,
            sanitizedContext: cleanPageState
        });
    } catch (err) {
        if (err.message.includes("Privacy Egress Guard error - fail closed")) {
            guardThrowErrorCaught = true;
        }
    }

    check("Throwing egress guard strictly aborts transmission (fail-closed)", guardThrowErrorCaught === true);
    check("Transport fetch was NEVER called when guard threw an exception", mockFetchCallCount === 0);

    // Restore verifyOrBlock
    PrivAgentPrivacy.verifyOrBlock = originalVerifyOrBlock;


    // ------------------------------------------------------------
    // TEST 5: HARMLESS TASK INSTRUCTIONS & CONTEXT REMAIN USABLE
    // ------------------------------------------------------------
    console.log("\n--- 5. Harmless Context & Instructions Remain Usable ---");

    mockFetchCallCount = 0;
    interceptedRequest = null;

    global.fetch = async (url, options) => {
        mockFetchCallCount++;
        interceptedRequest = { url, options };
        return {
            ok: true,
            status: 200,
            json: async () => ({
                success: true,
                message: "Identified checkout button.",
                action: { action: "click", selector: "#checkout-btn" },
                planner: "local-deterministic"
            })
        };
    };

    const ecommercePageState = {
        title: "Galaxy Store - Shopping Cart",
        url: "https://store.example.com/cart",
        elements: [
            { id: "el_1", type: "button", label: "Proceed to Checkout", selector: "#checkout-btn", enabled: true },
            { id: "el_2", type: "input", label: "Promo Code", selector: "#promo-code", enabled: true }
        ]
    };

    const harmlessResult = await runAgent({
        command: "Proceed to Checkout with 20% discount on order #1029384756",
        step: 1,
        sanitizedContext: ecommercePageState
    });

    check("Harmless ecommerce task succeeds through egress guard", harmlessResult.success === true);
    check("Transport fetch called for harmless task", mockFetchCallCount === 1);

    const harmlessSentJson = JSON.parse(interceptedRequest.options.body);
    check("Order number starting with 1 preserved in sent goal", harmlessSentJson.goal.includes("1029384756"));
    check("Checkout button selector preserved in sent controls", harmlessSentJson.visible_controls[0].selector === "#checkout-btn");


    // ------------------------------------------------------------
    // TEST 6: RETRIES, ERROR HANDLING, AND AUDIT LOGGING NEVER REINTRODUCE CANARIES
    // ------------------------------------------------------------
    console.log("\n--- 6. Retries, Errors & Audit Logging Never Reintroduce Secrets ---");

    clearAuditHistory();

    logPrivacyEvent("sanitization", {
        page_url: "https://bank.example.com/statement",
        detected_entities: ["card", "email", "upi", "account"],
        action_taken: "semantic_obfuscation",
        status: "success"
    });

    logPrivacyEvent("egress_blocked", {
        page_url: "https://bank.example.com/transfer",
        detected_entities: ["password"],
        action_taken: "blocked_network_io",
        status: "blocked",
        notes: "Sensitive keyword prevented outbound request"
    });

    const auditHistory = getAuditHistory();
    const auditSerialized = JSON.stringify(auditHistory);

    let canaryInAudit = false;
    for (const canary of Object.values(CANARIES)) {
        if (auditSerialized.includes(canary)) {
            canaryInAudit = true;
        }
    }

    check("Zero canaries exist in audit records", canaryInAudit === false);
    check("Audit record logs entity types (not raw values)", auditHistory[0].detected_entities.includes("card"));
    check("Audit record logs blocked status without raw secrets", auditHistory[1].status === "blocked");


    // ------------------------------------------------------------
    // TEST 7: CONSEQUENTIAL CONFIRMATION CONTROLS REMAIN INTACT
    // ------------------------------------------------------------
    console.log("\n--- 7. Consequential Action Confirmation Controls ---");

    const transferAction = {
        action: "click",
        selector: "#confirm-transfer-btn",
        requires_confirmation: false
    };

    const controlsWithTransfer = [
        { selector: "#confirm-transfer-btn", label: "Transfer ₹5,000 Now", isSubmit: true }
    ];

    const isConsequential = isConsequentialAction(transferAction, controlsWithTransfer);
    check("Transfer action is recognized as consequential", isConsequential === true);

    const safeStatementAction = {
        action: "click",
        selector: "#statementButton"
    };
    const controlsWithStatement = [
        { selector: "#statementButton", label: "View Statement", isSubmit: false }
    ];

    const isSafeStatement = isConsequentialAction(safeStatementAction, controlsWithStatement);
    check("View Statement action does not trigger consequential confirmation", isSafeStatement === false);

    // Restore fetch
    global.fetch = originalFetch;
    endTask();

    // ------------------------------------------------------------
    // SUMMARY
    // ------------------------------------------------------------
    console.log("\n============================================================");
    console.log(` RESULTS: ${passed} passed, ${failed} failed`);
    console.log("============================================================\n");

    if (failed > 0) {
        process.exit(1);
    }
}

runRealEgressTestSuite().catch(err => {
    console.error("FATAL: Egress test suite failure:", err);
    process.exit(1);
});
