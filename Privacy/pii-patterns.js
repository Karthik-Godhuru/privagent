const PII_PATTERNS = {
    email: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,

    phone: /(?:\+91[\s-]?)?[6-9]\d{9}\b/g,

    aadhaar: /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g,

    pan: /\b[A-Z]{5}[0-9]{4}[A-Z]\b/gi,

    card: /\b(?:\d[ -]*?){13,19}\b/g
};

module.exports = {
    PII_PATTERNS
};
