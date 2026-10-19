// ============================================================
// PRIVAGENT — Sensitive Input Guard Test
//
// Tests the SENSITIVE_INPUT_TYPES guard introduced in
// extension/content.js to prevent live field values from
// leaking into page-state labels.
//
// No framework required. Run with:
//   node integration/test-sensitive-input-guard.js
// ============================================================

// ---- Replicate the exact guard logic from content.js -------

const SENSITIVE_INPUT_TYPES = new Set([
    "password",
    "hidden",
    "tel",
]);

function getLabelForElement(element) {
    const isSensitive =
        element.tagName === "INPUT" &&
        SENSITIVE_INPUT_TYPES.has(
            (element.type || "").toLowerCase()
        );

    return (
        element.innerText ||
        element.getAttribute("aria-label") ||
        element.getAttribute("placeholder") ||
        (isSensitive ? "" : element.value) ||
        ""
    );
}


// ---- Minimal DOM element stub ------------------------------

function makeInput(type, value, ariaLabel, placeholder) {
    return {
        tagName: "INPUT",
        type: type,
        value: value || "",
        innerText: "",
        getAttribute: (attr) => {
            if (attr === "aria-label")  return ariaLabel  || null;
            if (attr === "placeholder") return placeholder || null;
            return null;
        },
    };
}

function makeButton(innerText) {
    return {
        tagName: "BUTTON",
        type: "",
        value: innerText,       // buttons can have .value but are not INPUT
        innerText: innerText,
        getAttribute: () => null,
    };
}


// ---- Test helpers ------------------------------------------

let passed = 0;
let failed = 0;

function assert(description, actual, expected) {
    if (actual === expected) {
        console.log(`  ✓  ${description}`);
        passed++;
    } else {
        console.error(`  ✗  ${description}`);
        console.error(`       expected: ${JSON.stringify(expected)}`);
        console.error(`       actual  : ${JSON.stringify(actual)}`);
        failed++;
    }
}


// ===========================================================
// TESTS — sensitive types must never expose .value
// ===========================================================

console.log("\n=== SENSITIVE INPUT GUARD TESTS ===\n");


// --- password field ----------------------------------------

console.log("password input:");

assert(
    "typed password value is suppressed",
    getLabelForElement(makeInput("password", "Tr0ub4dor&3")),
    ""
);
assert(
    "placeholder still returned when value is empty",
    getLabelForElement(makeInput("password", "", null, "Enter password")),
    "Enter password"
);
assert(
    "aria-label still returned when value is present",
    getLabelForElement(makeInput("password", "Tr0ub4dor&3", "Password field")),
    "Password field"
);


// --- hidden field ------------------------------------------

console.log("\nhidden input:");

assert(
    "CSRF token value is suppressed",
    getLabelForElement(makeInput("hidden", "csrf-abc123xyz")),
    ""
);


// --- tel field ---------------------------------------------

console.log("\ntel input (OTP / phone):");

assert(
    "phone number value is suppressed",
    getLabelForElement(makeInput("tel", "9876543210")),
    ""
);
assert(
    "placeholder still returned for tel",
    getLabelForElement(makeInput("tel", "9876543210", null, "Enter OTP")),
    "Enter OTP"
);
assert(
    "aria-label still returned for tel",
    getLabelForElement(makeInput("tel", "9876543210", "OTP field")),
    "OTP field"
);


// --- TYPE CASE INSENSITIVITY --------------------------------

console.log("\ntype attribute case insensitivity:");

assert(
    "PASSWORD (uppercase type) is also blocked",
    getLabelForElement(makeInput("PASSWORD", "secret")),
    ""
);


// ===========================================================
// TESTS — safe types must still expose .value
// ===========================================================

console.log("\n--- SAFE TYPES (value must still be readable) ---\n");

console.log("text input:");

assert(
    "non-sensitive text input returns value as label",
    getLabelForElement(makeInput("text", "Transfer Money")),
    "Transfer Money"
);
assert(
    "empty text input returns empty string",
    getLabelForElement(makeInput("text", "")),
    ""
);

console.log("\nnumber input:");

assert(
    "number input (transfer amount) returns value as label",
    getLabelForElement(makeInput("number", "5000")),
    "5000"
);

console.log("\nbutton (non-INPUT element):");

assert(
    "button element with innerText returns innerText",
    getLabelForElement(makeButton("Transfer Money")),
    "Transfer Money"
);


// ===========================================================
// SUMMARY
// ===========================================================

console.log(`\n${"=".repeat(40)}`);
console.log(`  Passed: ${passed}   Failed: ${failed}`);
console.log(`${"=".repeat(40)}\n`);

if (failed > 0) {
    process.exit(1);
}
