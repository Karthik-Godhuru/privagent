function detectSensitiveData(text) {
  const detections = [];

  if (!text || typeof text !== "string") {
    return detections;
  }

  const patterns = [
    {
      type: "email",
      regex: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi
    },
    {
      type: "phone",
      regex: /\b(?:\+91[-\s]?)?[6-9]\d{9}\b/g
    },
    {
      type: "account_number",
      regex: /\b\d{10,18}\b/g
    },
    {
      type: "upi_id",
      regex: /\b[a-zA-Z0-9._-]+@[a-zA-Z]{2,}\b/g
    },
    {
      type: "pan_number",
      regex: /\b[A-Z]{5}[0-9]{4}[A-Z]\b/gi
    },
    {
      type: "aadhaar_number",
      regex: /\b\d{4}[-\s]\d{4}[-\s]\d{4}\b/g
    },
    {
      type: "password",
      regex: /\b(password|passcode|pin|otp)\b/gi
    }
  ];

  for (const pattern of patterns) {
    const matches = text.match(pattern.regex);

    if (matches) {
      for (const match of matches) {
        detections.push({
          type: pattern.type,
          value: match
        });
      }
    }
  }

  return detections;
}

function maskValue(value, type) {
  if (!value) {
    return "[REDACTED]";
  }

  switch (type) {
    case "email": {
      const parts = value.split("@");

      if (parts.length === 2) {
        const username = parts[0];
        const domain = parts[1];

        const visiblePart =
          username.length > 2
            ? username.substring(0, 2)
            : username.substring(0, 1);

        return `${visiblePart}***@${domain}`;
      }

      return "[REDACTED_EMAIL]";
    }

    case "phone":
      return value.slice(0, 2) + "******" + value.slice(-2);

    case "account_number":
      return "******" + value.slice(-4);

    case "upi_id": {
      const parts = value.split("@");

      if (parts.length === 2) {
        return "user***@" + parts[1];
      }

      return "[REDACTED_UPI]";
    }

    case "pan_number":
      return "*****" + value.slice(-1);

    case "aadhaar_number":
      return "XXXX XXXX " + value.replace(/\D/g, "").slice(-4);

    case "password":
      return "[REDACTED_SECRET]";

    default:
      return "[REDACTED]";
  }
}

function sanitizeText(text) {
  if (!text || typeof text !== "string") {
    return {
      sanitizedText: "",
      detections: [],
      redactionCount: 0
    };
  }

  let sanitizedText = text;
  const detections = detectSensitiveData(text);

  for (const detection of detections) {
    const maskedValue = maskValue(
      detection.value,
      detection.type
    );

    sanitizedText = sanitizedText.split(detection.value).join(maskedValue);
  }

  return {
    sanitizedText,
    detections,
    redactionCount: detections.length
  };
}

function sanitizePageInformation(pageInformation) {
  const sanitizedPage = {
    pageTitle: pageInformation.pageTitle || "",
    url: pageInformation.url || "",
    buttons: [],
    inputs: [],
    links: [],
    visibleText: "",
    privacyReport: {
      sensitiveItemsDetected: 0,
      detectedTypes: [],
      protectionStatus: "Protected locally"
    }
  };

  const allDetections = [];

  const titleResult = sanitizeText(pageInformation.pageTitle || "");
  sanitizedPage.pageTitle = titleResult.sanitizedText;
  allDetections.push(...titleResult.detections);

  const textResult = sanitizeText(pageInformation.visibleText || "");
  sanitizedPage.visibleText = textResult.sanitizedText;
  allDetections.push(...textResult.detections);

  sanitizedPage.buttons = pageInformation.buttons.map((button) => {
    const result = sanitizeText(button.text || "");

    allDetections.push(...result.detections);

    return {
      ...button,
      text: result.sanitizedText
    };
  });

  sanitizedPage.inputs = pageInformation.inputs.map((input) => {
    const valueResult = sanitizeText(input.value || "");
    const placeholderResult = sanitizeText(input.placeholder || "");

    allDetections.push(...valueResult.detections);
    allDetections.push(...placeholderResult.detections);

    return {
      ...input,
      value: valueResult.sanitizedText,
      placeholder: placeholderResult.sanitizedText
    };
  });

  sanitizedPage.links = pageInformation.links.map((link) => {
    const textResult = sanitizeText(link.text || "");

    allDetections.push(...textResult.detections);

    return {
      ...link,
      text: textResult.sanitizedText
    };
  });

  sanitizedPage.privacyReport.sensitiveItemsDetected =
    allDetections.length;

  sanitizedPage.privacyReport.detectedTypes = [
    ...new Set(allDetections.map((item) => item.type))
  ];

  return sanitizedPage;
}
