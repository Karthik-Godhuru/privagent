// ============================================================
// PRIVAGENT PII & SENSITIVE DATA PATTERNS
//
// Declared Detection Scope:
// - Email addresses (including NFKC-normalized variants)
// - UPI IDs (user@okhdfcbank, merchant@upi)
// - Contextual Bank Account numbers (9-18 digits)
// - Contextual OTP / PIN / CVV / verification codes (3-8 digits)
// - Contextual user passwords (password: ...)
// - Bearer tokens and Authorization credentials
// - Contextual API keys / secret tokens
// - International Bank Account Numbers (IBAN: country code + check digits + bban)
// - Payment cards (13-19 digits, Visa, MC, Amex, RuPay)
// - US Social Security Numbers (3-2-4 digits: \d{3}-\d{2}-\d{4})
// - Indian Aadhaar (12 digits, leading digit 2-9)
// - Phone numbers (Indian 10-digit / +91, US/Intl 10-digit)
// - Indian PAN card (5 letters + 4 digits + 1 letter)
//
// Explicit Limitations / Unsupported Formats:
// - Freeform natural-language passwords without keyword context (e.g. "hunter2")
// - Custom cryptographic keys, private PGP keys or non-standard token formats
// - Non-standard national IDs (e.g. UK National Insurance, Canadian SIN)
// - Physical addresses or geographic coordinates without explicit postal tags
// ============================================================

const PII_PATTERNS = {
    // 1. Email Addresses
    email: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/gi,

    // 2. UPI IDs (e.g. user@okhdfcbank, payment@upi, 9876543210@paytm)
    upi: /\b[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z]{2,64}\b/gi,

    // 3. Contextual Bank Account Numbers (e.g., A/C No: 123456789012, Account: 987654321098)
    account: /\b(?:a\/c|account|acc|acct)(?:\s+no\.?|\s+number|\s+#)?[:\s-]+([0-9]{9,18})\b/gi,

    // 4. Contextual OTP / PIN / CVV (e.g., OTP: 492810, PIN: 1234, CVV: 891)
    otp: /\b(?:otp|one[- ]?time[- ]?password|verification[- ]?code|security[- ]?code|pin|cvv|cvc)[:\s-]+([0-9]{3,8})\b/gi,

    // 5. Contextual Passwords (e.g., password: MySecretPass123, passwd: abc)
    password: /\b(?:password|passwd|pwd)[:\s=]+([^\s,;]{4,})\b/gi,

    // 6. Bearer Tokens & Authorization Credentials
    bearer: /\bBearer\s+([A-Za-z0-9_\-\.]{16,})\b/gi,

    // 7. Contextual API Keys & Secret Tokens
    auth_token: /\b(?:api[-_]?key|secret[-_]?key|auth[-_]?token|access[-_]?token|private[-_]?key)[:\s=]+([A-Za-z0-9_\-\.]{12,})\b/gi,

    // 8. International Bank Account Numbers (IBAN: 2 letters + 2 digits + up to 30 alphanumeric)
    iban: /\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{2,4}){3,8}\b/gi,

    // 9. Payment Cards (13-19 digits, evaluated after IBAN to prevent partial slicing)
    card: /\b(?:\d[ -]?){13,19}\b/g,

    // 10. US Social Security Numbers (SSN: 3 digits - 2 digits - 4 digits)
    ssn: /\b\d{3}-\d{2}-\d{4}\b/g,

    // 11. Indian Aadhaar (12 digits, first digit 2-9 to avoid false positives on 0/1 order IDs)
    aadhaar: /\b[2-9]\d{3}[\s-]?\d{4}[\s-]?\d{4}\b/g,

    // 12. Indian Phone Numbers (+91 or 10 digits starting 6-9)
    phone: /\b(?:\+91[\s-]?)?[6-9]\d{9}\b/g,

    // 13. US / International Phone Numbers (10 digits with standard delimiters)
    phone_intl: /\b(?:\+1[\s-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/g,

    // 14. Indian PAN Card (5 uppercase letters + 4 digits + 1 uppercase letter)
    pan: /\b[A-Z]{5}\d{4}[A-Z]\b/gi
};

module.exports = {
    PII_PATTERNS
};
