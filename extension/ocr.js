
async function createLocalOCRWorker() {
  if (typeof Tesseract === "undefined") {
    throw new Error("Local Tesseract.js library is unavailable.");
  }

  return Tesseract.createWorker("eng", 1, {
    workerPath: chrome.runtime.getURL(
      "vendor/tesseract/api/package/dist/worker.min.js"
    ),
    corePath: chrome.runtime.getURL(
      "vendor/tesseract/core/package"
    ),
    langPath: chrome.runtime.getURL(
      "vendor/tesseract/lang/package/4.0.0_best_int"
    ),
    workerBlobURL: false,
    gzip: true,
    logger: () => {}
  });
}

const PII_PATTERNS = [
  {
    type: "email",
    pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i
  },
  {
    type: "phone",
    pattern: /(?:\+91[\s-]?)?[6-9]\d{9}\b/
  },
  {
    type: "aadhaar",
    pattern: /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/
  },
  {
    type: "pan",
    pattern: /\b[A-Z]{5}[0-9]{4}[A-Z]\b/i
  },
  {
    type: "card",
    pattern: /\b(?:\d[ -]*?){13,19}\b/
  }
];



function findSensitiveLines(lines) {
  if (!Array.isArray(lines)) {
    throw new Error("OCR lines are unavailable.");
  }

  for (const line of lines) {
    if (
      typeof line.text !== "string" ||
      !line.bbox ||
      !["x0", "y0", "x1", "y1"].every(
        (key) => Number.isFinite(line.bbox[key])
      )
    ) {
      throw new Error("OCR returned an invalid line.");
    }
  }

  const sensitiveIndexes = new Set();

  const fieldLabels = [
    "customer name",
    "account number",
    "phone number",
    "mobile number",
    "email address",
    "aadhaar number",
    "pan number",
    "card number"
  ];

  for (let i = 0; i < lines.length; i++) {
    const text = lines[i].text.trim();
    const normalized = text.toLowerCase();

    // Keep detecting obvious PII anywhere in an OCR line.
    if (PII_PATTERNS.some(({ pattern }) => pattern.test(text))) {
      sensitiveIndexes.add(i);
    }

    for (const label of fieldLabels) {
      const labelPattern = new RegExp(
        "^\\s*" + label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") +
        "\\s*[:：-]?\\s*$",
        "i"
      );

      if (labelPattern.test(normalized) && i + 1 < lines.length) {
        // Label is on its own line: redact the value line, not the label.
        sensitiveIndexes.add(i + 1);
      }
    }
  }

  return [...sensitiveIndexes].map((index) => lines[index]);
}



async function redactScreenshotDataUrl(dataUrl) {
  if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/")) {
    throw new Error("Invalid screenshot image.");
  }

  const worker = await createLocalOCRWorker();

  try {
    const image = new Image();

    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error("Screenshot image could not be loaded."));
      image.src = dataUrl;
    });

    const { data } = await worker.recognize(image, {}, { text: true, blocks: true });

    if (
  !data ||
  !Array.isArray(data.blocks) ||
  data.blocks.length === 0
) {
  throw new Error("OCR did not return usable bounding boxes.");
}

    const lines = [];

    for (const block of data.blocks) {
      for (const paragraph of block.paragraphs || []) {
        for (const line of paragraph.lines || []) {
          lines.push({
            text: line.text,
            bbox: line.bbox
          });
        }
      }
    }

    const sensitiveLines = findSensitiveLines(lines);

    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;

    const context = canvas.getContext("2d", { alpha: false });

    if (!context || !canvas.width || !canvas.height) {
      throw new Error("Screenshot redaction canvas is unavailable.");
    }

    context.drawImage(image, 0, 0);
    context.fillStyle = "#000000";

    for (const line of sensitiveLines) {
      const { x0, y0, x1, y1 } = line.bbox;

      if (![x0, y0, x1, y1].every(Number.isFinite) ||
          x0 < 0 || y0 < 0 || x1 <= x0 || y1 <= y0 ||
          x1 > canvas.width || y1 > canvas.height) {
        throw new Error("Invalid OCR bounding box; refusing to release screenshot.");
      }

      const pad = 3;
      const left = Math.max(0, Math.floor(x0 - pad));
      const top = Math.max(0, Math.floor(y0 - pad));
      const right = Math.min(canvas.width, Math.ceil(x1 + pad));
      const bottom = Math.min(canvas.height, Math.ceil(y1 + pad));

      context.fillRect(left, top, right - left, bottom - top);
    }

    return {
      dataUrl: canvas.toDataURL("image/png"),
      redactedLines: sensitiveLines.length
    };
  } finally {
    await worker.terminate();
  }
}

globalThis.redactScreenshotDataUrl = redactScreenshotDataUrl;
globalThis.createLocalOCRWorker = createLocalOCRWorker;
globalThis.findSensitiveLines = findSensitiveLines;
