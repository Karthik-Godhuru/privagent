// ============================================================
// PRIVAGENT — AGENT MODULE VALIDATION TEST
//
// Tests:
// 1. agent/action-schema.js: action schema and format validity.
// 2. agent/action-validator.js: grounded selector validation against page state.
//
// Run with: node integration/test-agent-modules.js
// ============================================================

const { ALLOWED_ACTIONS, isValidAction } = require("../agent/action-schema");
const { validateAction } = require("../agent/action-validator");

let passed = 0;
let failed = 0;

function check(description, condition) {
    if (condition) {
        console.log(`  ✓  ${description}`);
        passed++;
    } else {
        console.error(`  ✗  ${description}`);
        failed++;
    }
}

console.log("\n============================================================");
console.log(" PRIVAGENT AGENT MODULES TEST SUITE");
console.log("============================================================\n");

// --- 1. Action Schema Validation ---
console.log("--- 1. Action Schema Validation ---");
check("Allowed actions includes click, type, scroll, navigate, wait, noop",
    ALLOWED_ACTIONS.includes("click") &&
    ALLOWED_ACTIONS.includes("type") &&
    ALLOWED_ACTIONS.includes("scroll") &&
    ALLOWED_ACTIONS.includes("navigate") &&
    ALLOWED_ACTIONS.includes("wait") &&
    ALLOWED_ACTIONS.includes("noop")
);

check("Rejects null or non-object action", !isValidAction(null) && !isValidAction("click"));
check("Rejects unknown action type", !isValidAction({ action: "exec_eval" }));
check("Rejects click without selector", !isValidAction({ action: "click" }));
check("Rejects navigate without URL", !isValidAction({ action: "navigate" }));
check("Accepts valid click action with selector", isValidAction({ action: "click", selector: "#btn-submit" }));
check("Accepts valid navigate action with URL", isValidAction({ action: "navigate", url: "https://example.com" }));
check("Accepts wait action without selector", isValidAction({ action: "wait" }));
check("Accepts noop action without selector", isValidAction({ action: "noop" }));

// --- 2. Action Target Grounding Validation ---
console.log("\n--- 2. Action Target Grounding Validation ---");

const mockPageState = {
    title: "Demo Portal",
    url: "http://localhost/test",
    elements: [
        { selector: "#login-button", label: "Login" },
        { selector: "#search-input", label: "Search" }
    ]
};

const groundedClick = { action: "click", selector: "#login-button" };
const ungroundedClick = { action: "click", selector: "#fake-button" };
const groundedType = { action: "type", selector: "#search-input", value: "shoes" };
const ungroundedType = { action: "type", selector: "#unmatched-field", value: "shoes" };

const resultGroundedClick = validateAction(groundedClick, mockPageState);
check("Approves grounded click on existing DOM selector", resultGroundedClick.allowed === true);

const resultUngroundedClick = validateAction(ungroundedClick, mockPageState);
check("Blocks ungrounded click targeting missing DOM selector", resultUngroundedClick.allowed === false);

const resultGroundedType = validateAction(groundedType, mockPageState);
check("Approves grounded type action", resultGroundedType.allowed === true);

const resultUngroundedType = validateAction(ungroundedType, mockPageState);
check("Blocks ungrounded type action targeting missing DOM selector", resultUngroundedType.allowed === false);

const resultNavigate = validateAction({ action: "navigate", url: "https://safe.example.com" }, mockPageState);
check("Approves navigate action format", resultNavigate.allowed === true);

const resultWait = validateAction({ action: "wait" }, mockPageState);
check("Approves non-targeted wait action", resultWait.allowed === true);

console.log("\n============================================================");
console.log(` RESULTS: ${passed} passed, ${failed} failed`);
console.log("============================================================\n");

if (failed > 0) {
    process.exit(1);
}
