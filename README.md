# PRIVAGENT

## Privacy-Preserving Browser AI Agent

PRIVAGENT is a privacy-preserving browser AI agent prototype designed to understand webpage content while protecting sensitive user information locally.

The project focuses on extracting visible webpage information, detecting sensitive data, masking that information, and displaying a sanitized analysis result.

---

## Problem Statement

Modern browser AI agents may need to access webpage content to understand user tasks. However, webpages can contain sensitive information such as:

- Account numbers
- Phone numbers
- Email addresses
- UPI IDs
- PAN numbers
- Aadhaar numbers
- Passwords
- PINs
- OTP-related information

Sending such information directly to an external AI service can create privacy and security risks.

PRIVAGENT addresses this problem by performing initial webpage analysis and sensitive-data masking locally inside the browser.

---

## Project Objective

The main objective of PRIVAGENT is to:

1. Extract visible information from a webpage.
2. Identify sensitive information using local detection rules.
3. Mask detected sensitive values.
4. Generate a sanitized webpage representation.
5. Display the analysis result through a browser extension popup.
6. Reduce the possibility of exposing private information to external AI systems.

---

## Current Features

- Browser extension popup interface.
- Webpage information extraction.
- Visible text extraction.
- Button extraction.
- Input and form-field extraction.
- Link extraction.
- Local sensitive-data detection.
- Sensitive-value masking.
- Privacy report generation.
- Analysis result display.
- Banking webpage test environment.
- Error handling for unsupported or restricted pages.

---

## Privacy Protection

PRIVAGENT currently detects and masks sensitive information such as:

| Sensitive Data Type | Example Masking |
|---|---|
| Account number | `******9012` |
| Phone number | `98******10` |
| Email address | `ka***@example.com` |
| UPI ID | `user***@upi` |
| PAN number | `*****A` |
| Aadhaar number | `XXXX XXXX 9012` |
| Password or PIN-related text | `[REDACTED_SECRET]` |

The masking process is performed locally by the extension's privacy module.

---

## Technology Stack

- HTML
- CSS
- JavaScript
- Chrome Extension Manifest V3
- Chrome Content Scripts
- Chrome Extension Popup
- GitHub
- Local browser-based processing

---

## Project Structure

```text
privagent/
│
├── extension/
│   ├── manifest.json
│   ├── popup.html
│   ├── popup.js
│   ├── styles.css
│   ├── privacy.js
│   └── content.js
│
├── test-pages/
│   └── banking.html
│
└── README.md
