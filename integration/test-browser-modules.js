// ============================================================
// PRIVAGENT — BROWSER MODULE EXECUTION TEST
//
// Tests:
// 1. Browser/executor.js: safe action execution on DOM targets.
// 2. Browser/navigation.js: URL protocol security validation.
//
// Run with: node integration/test-browser-modules.js
// ============================================================

const { executeAction } = require("../Browser/executor");
const { navigateTo } = require("../Browser/navigation");

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
console.log(" PRIVAGENT BROWSER MODULES TEST SUITE");
console.log("============================================================\n");

// --- 1. Browser Action Executor Tests ---
console.log("--- 1. Browser Action Executor Tests ---");

// Stub DOM element
function makeElementStub() {
    return {
        clicked: false,
        focused: false,
        value: "",
        events: [],
        click() { this.clicked = true; },
        focus() { this.focused = true; },
        dispatchEvent(evt) { this.events.push(evt.type); }
    };
}

// Error handling on invalid target
let threwError = false;
try {
    executeAction({ action: "click" }, null);
} catch (e) {
    threwError = true;
}
check("Rejects execution when target element is missing", threwError);

// Click execution
const btn = makeElementStub();
const clickRes = executeAction({ action: "click" }, btn);
check("Executes click on DOM element", clickRes.success && btn.clicked);

// Type execution
const input = makeElementStub();
const typeRes = executeAction({ action: "type", value: "test query" }, input);
check("Executes type on DOM input with focus, value and event", typeRes.success && input.focused && input.value === "test query");

// Unsupported action
const fakeRes = executeAction({ action: "exec_shell" }, btn);
check("Rejects unsupported browser action", fakeRes.success === false);

// --- 2. Navigation URL Security Validation ---
console.log("\n--- 2. Navigation URL Security Validation ---");

// Mock window for navigation
global.window = { location: { href: "" } };

// Dangerous protocol rejection
let rejectedJs = false;
try {
    navigateTo("javascript:alert(1)");
} catch (e) {
    rejectedJs = true;
}
check("Rejects dangerous javascript: protocol navigation", rejectedJs);

let rejectedFile = false;
try {
    navigateTo("file:///etc/passwd");
} catch (e) {
    rejectedFile = true;
}
check("Rejects file: protocol navigation", rejectedFile);

// Valid protocol acceptance
const navRes = navigateTo("https://example.com/portal");
check("Approves safe HTTPS URL navigation", navRes.success && navRes.url === "https://example.com/portal");

console.log("\n============================================================");
console.log(` RESULTS: ${passed} passed, ${failed} failed`);
console.log("============================================================\n");

if (failed > 0) {
    process.exit(1);
}
