const { detectPII } = require("../Privacy/detector");
const { sanitizeText } = require("../Privacy/sanitizer");
const { applyPrivacyPolicy } = require("../Privacy/policy");

const testText = `
Checkout page

Name: Karthik
Email: karthik@example.com
Phone: 9876543210

Product: Samsung Galaxy Book
Price: ₹85,000
`;

console.log("=== PRIVAGENT PRIVACY TEST ===");

console.log("\n1. Original data:");
console.log(testText);

const findings = detectPII(testText);

console.log("\n2. Detected sensitive data:");
console.log(findings);

const sanitizedText = sanitizeText(testText);

console.log("\n3. Sanitized data:");
console.log(sanitizedText);

const policyResult = applyPrivacyPolicy({
    title: "Checkout",
    text: sanitizedText,
    url: "https://example.com/checkout"
});

console.log("\n4. Policy result:");
console.log(policyResult);

// Automated assertions
const emailFound = findings.some(f => f.type === "email" && f.count === 1);
const phoneFound = findings.some(f => f.type === "phone" && f.count === 1);
const emailRedacted = sanitizedText.includes("[EMAIL_REDACTED]") && !sanitizedText.includes("karthik@example.com");
const phoneRedacted = sanitizedText.includes("[PHONE_REDACTED]") && !sanitizedText.includes("9876543210");
const policyAllowed = policyResult.allowed === true && policyResult.state.title === "Checkout";

if (!emailFound || !phoneFound || !emailRedacted || !phoneRedacted || !policyAllowed) {
    console.error("\n❌ PRIVACY TEST FAILED: Redaction or policy check failed.");
    process.exit(1);
}

console.log("\n✓ All privacy checks passed successfully.");
console.log("\n=== TEST COMPLETE ===");
