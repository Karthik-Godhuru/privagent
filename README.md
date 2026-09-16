# PRIVAGENT

PRIVAGENT is a privacy-preserving browser AI agent prototype designed to extract webpage information, detect sensitive data, and redact that data locally before it can be used for further AI processing.

The project focuses on privacy-first browser automation, local data protection, and responsible AI-agent interaction.

---

## Project Status

PRIVAGENT is currently a browser-extension prototype developed for educational, research, and hackathon purposes.

The current prototype includes:

- Chrome extension setup using Manifest V3
- Webpage information extraction
- Local sensitive-data detection
- Local sensitive-data redaction
- Popup-based analysis results
- Test webpage for banking-related information

---

## Key Features

### 1. Webpage Information Extraction

The extension extracts selected information from the active webpage, including:

- Page title
- Current webpage URL
- Visible webpage text
- Buttons
- Input fields
- Textareas
- Select fields
- Links

### 2. Local Sensitive-Data Detection

The privacy module checks for common types of sensitive information, including:

- Email addresses
- Phone numbers
- Account numbers
- UPI IDs
- PAN numbers
- Aadhaar numbers
- Password-related keywords
- PIN-related keywords
- OTP-related keywords

### 3. Sensitive-Data Redaction

Detected sensitive information is masked locally before the sanitized webpage information is returned to the extension popup.

Example:

```text
Original:
karthik@example.com

Redacted:
ka***@example.com
