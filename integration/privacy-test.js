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

console.log("\n=== TEST COMPLETE ===");
