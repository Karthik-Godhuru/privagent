
const assert = require("node:assert/strict");
const { detectPII } = require("../Privacy/detector");
const { sanitizeText } = require("../Privacy/sanitizer");
const { applyPrivacyPolicy } = require("../Privacy/policy");
const { sanitizePageState } = require("../extension/privacy-gate.js");

const tests = [
    ["Detects email", () => {
        assert.ok(detectPII("user@example.com").some(x => x.type === "email"));
    }],
    ["Detects phone", () => {
        assert.ok(detectPII("9876543210").some(x => x.type === "phone"));
    }],
    ["Redacts email and phone", () => {
        const output = sanitizeText("user@example.com 9876543210");
        assert.ok(output.includes("[EMAIL_REDACTED]"));
        assert.ok(output.includes("[PHONE_REDACTED]"));
        assert.ok(!output.includes("user@example.com"));
        assert.ok(!output.includes("9876543210"));
    }],
    ["Redacts Aadhaar-like identifier", () => {
        const output = sanitizeText("1234 5678 9012");
        assert.ok(output.includes("[AADHAAR_REDACTED]"));
        assert.ok(!output.includes("1234 5678 9012"));
    }],
    ["Redacts PAN-like identifier", () => {
        const output = sanitizeText("ABCDE1234F");
        assert.ok(output.includes("[PAN_REDACTED]"));
        assert.ok(!output.includes("ABCDE1234F"));
    }],
    ["Preserves ordinary product text and price", () => {
        const input = "Samsung Galaxy Book; Price: INR 85000";
        assert.equal(sanitizeText(input), input);
    }],
    ["Rejects invalid page state", () => {
        assert.equal(applyPrivacyPolicy(null).allowed, false);
    }],
    ["Excludes disallowed fields", () => {
        const result = applyPrivacyPolicy({
            title: "Checkout",
            text: "Safe text",
            password: "should-not-pass",
            cookies: "should-not-pass"
        });
        assert.equal(result.allowed, true);
        assert.equal(result.state.title, "Checkout");
        assert.equal(result.state.text, "Safe text");
        assert.equal("password" in result.state, false);
        assert.equal("cookies" in result.state, false);
    }],
    ["Harmless action button text is preserved", () => {
        assert.equal(sanitizeText("Show Password"), "Show Password");
        assert.equal(sanitizeText("Forgot Password?"), "Forgot Password?");
        assert.equal(sanitizeText("Send OTP"), "Send OTP");
        assert.equal(sanitizeText("Reset Password"), "Reset Password");
    }],
    ["Sensitive payment card numbers are redacted while preserving ordinary labels", () => {
        const output = sanitizeText("Pay with Card: 4111222233334444");
        assert.ok(output.includes("[CARD_REDACTED]"));
        assert.ok(!output.includes("4111222233334444"));
        assert.ok(output.includes("Pay with Card:"));
    }],
    ["Accessible-name (ariaLabel) sanitization does not expose sensitive text", () => {
        const rawState = {
            title: "Account Settings",
            url: "https://example.com/settings",
            elements: [
                {
                    id: "btnProfile",
                    type: "button",
                    role: "button",
                    label: "Profile",
                    ariaLabel: "User profile for test.user@example.com, phone 9876543210, card 4111222233334444",
                    selector: "#btnProfile",
                    enabled: true,
                    visible: true
                },
                {
                    id: "btnSearch",
                    type: "button",
                    role: "button",
                    label: "Search",
                    ariaLabel: "Search Wikipedia",
                    selector: "#btnSearch",
                    enabled: true,
                    visible: true
                }
            ]
        };

        const sanitized = sanitizePageState(rawState);
        const profileEl = sanitized.elements[0];
        const searchEl = sanitized.elements[1];

        assert.ok(profileEl.ariaLabel.includes("[EMAIL_REDACTED]"));
        assert.ok(profileEl.ariaLabel.includes("[PHONE_REDACTED]"));
        assert.ok(profileEl.ariaLabel.includes("[CARD_REDACTED]"));
        assert.ok(!profileEl.ariaLabel.includes("test.user@example.com"));
        assert.ok(!profileEl.ariaLabel.includes("9876543210"));
        assert.ok(!profileEl.ariaLabel.includes("4111222233334444"));

        assert.equal(searchEl.ariaLabel, "Search Wikipedia");
        assert.equal(searchEl.role, "button");
        assert.equal(searchEl.visible, true);
    }]
];

let failures = 0;

for (const [name, test] of tests) {
    try {
        test();
        console.log(`PASS: ${name}`);
    } catch (error) {
        failures++;
        console.error(`FAIL: ${name}`);
        console.error(`  ${error.message}`);
    }
}

console.log(`\n${tests.length - failures}/${tests.length} tests passed.`);

if (failures > 0) {
    process.exitCode = 1;
} else {
    console.log("All privacy regression tests passed.");
}
