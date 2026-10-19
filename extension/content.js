// ============================================================
// PRIVAGENT CONTENT SCRIPT
// ============================================================

console.log("PrivAgent content script loaded.");


// ------------------------------------------------------------
// PAGE STATE
// ------------------------------------------------------------

function getPageState() {
    try {
        if (
            typeof PrivAgentPrivacy === "undefined" ||
            typeof PrivAgentPrivacy.sanitizePageState !== "function"
        ) {
            console.error("PrivAgent Privacy Gate is not available - fail-closed.");
            return {
                success: false,
                error: "Privacy Gate not available - fail closed"
            };
        }

        const elements = findInteractiveElements();

        const rawPageState = {
            title: document.title || "",
            url: window.location.href || "",
            text: document.body?.innerText || "",
            elements: elements
        };

        const sanitized = PrivAgentPrivacy.sanitizePageState(rawPageState);

        return {
            success: true,
            pageState: sanitized
        };

    } catch (error) {
        console.error("PrivAgent sanitization failure - fail-closed:", error);
        return {
            success: false,
            error: "Sanitization failed - fail closed: " + (error?.message || "Unknown error")
        };
    }
}

// ------------------------------------------------------------
// SENSITIVE INPUT TYPES & SEMANTIC CHECK
// ------------------------------------------------------------

const SENSITIVE_INPUT_TYPES = new Set([
    "password", // login / PIN fields
    "hidden",   // CSRF tokens, session IDs, internal state
    "tel",      // phone / OTP fields on banking forms
]);

const SENSITIVE_FIELD_KEYWORDS = [
    "password", "passwd", "secret", "token", "otp",
    "cvv", "cvc", "pin", "ssn", "aadhaar", "pan",
    "card_number", "cardnumber", "passport"
];

function isSensitiveElement(element) {
    if (!element || (element.tagName !== "INPUT" && element.tagName !== "TEXTAREA")) {
        return false;
    }

    const type = (element.type || "").toLowerCase();
    if (SENSITIVE_INPUT_TYPES.has(type)) {
        return true;
    }

    const autocomplete = (element.getAttribute("autocomplete") || "").toLowerCase();
    if (
        autocomplete.includes("password") ||
        autocomplete.includes("one-time-code") ||
        autocomplete.includes("cc-") ||
        autocomplete.includes("card")
    ) {
        return true;
    }

    const identifier = [
        element.name || "",
        element.id || "",
        element.getAttribute("aria-label") || "",
        element.getAttribute("placeholder") || ""
    ].join(" ").toLowerCase();

    for (const word of SENSITIVE_FIELD_KEYWORDS) {
        const regex = new RegExp(`(^|[^a-z0-9])${word}([^a-z0-9]|$)`, "i");
        if (regex.test(identifier)) {
            return true;
        }
    }

    return false;
}

function getElementLabel(element, isSensitive) {
    // 1. Visible inner text (buttons, links)
    if (element.innerText && element.innerText.trim()) {
        return element.innerText.trim();
    }

    // 2. Explicit accessibility label
    const ariaLabel = element.getAttribute("aria-label");
    if (ariaLabel && ariaLabel.trim()) {
        return ariaLabel.trim();
    }

    // 3. Associated DOM <label> tag
    if (element.id) {
        try {
            const escapedId = (window.CSS && CSS.escape) ? CSS.escape(element.id) : element.id;
            const labelElem = document.querySelector(`label[for="${escapedId}"]`);
            if (labelElem && labelElem.innerText && labelElem.innerText.trim()) {
                return labelElem.innerText.trim();
            }
        } catch (_) {}
    }

    if (element.closest) {
        const parentLabel = element.closest("label");
        if (parentLabel && parentLabel.innerText && parentLabel.innerText.trim()) {
            return parentLabel.innerText.trim();
        }
    }

    // 4. Placeholder
    const placeholder = element.getAttribute("placeholder");
    if (placeholder && placeholder.trim()) {
        return placeholder.trim();
    }

    // 5. Value fallback (ONLY for non-sensitive inputs)
    if (!isSensitive && element.value && typeof element.value === "string") {
        return element.value.trim();
    }

    return "";
}


// ------------------------------------------------------------
// FIND INTERACTIVE ELEMENTS
// ------------------------------------------------------------

function findInteractiveElements() {

    const elements = document.querySelectorAll(
        "button, input, select, textarea, a"
    );

    return Array.from(elements).map((element, index) => {

        const isSensitive = isSensitiveElement(element);
        const rawLabel = getElementLabel(element, isSensitive);
        const subtype = (element.getAttribute("type") || element.type || "").toLowerCase();
        const isSubmit = subtype === "submit" || (element.tagName === "BUTTON" && (!subtype || subtype === "submit") && !!element.form);

        return {
            id: `element_${index}`,

            type: element.tagName.toLowerCase(),

            subtype: subtype,

            isSubmit: isSubmit,

            label: rawLabel,

            selector: createSelector(element),

            enabled: !element.disabled
        };

    });
}


// ------------------------------------------------------------
// CREATE SIMPLE SELECTOR
// ------------------------------------------------------------

function createSelector(element) {

    if (!element.dataset.privagentId) {

        element.dataset.privagentId =
            `pa-${Math.random()
                .toString(36)
                .slice(2, 10)}`;
    }

    return `[data-privagent-id="${element.dataset.privagentId}"]`;
}


// ------------------------------------------------------------
// FIND ELEMENT BY SELECTOR
// ------------------------------------------------------------

function getElement(selector) {

    if (!selector) {
        return null;
    }

    try {
        return document.querySelector(selector);
    } catch (error) {
        console.error("Invalid selector:", selector);
        return null;
    }
}


// ------------------------------------------------------------
// EXECUTE ACTION
// ------------------------------------------------------------

function executeBrowserAction(action) {

    if (!action || !action.action) {
        return {
            success: false,
            error: "Invalid action."
        };
    }


    switch (action.action) {

        case "click": {

            const element = getElement(action.selector);

            if (!element) {
                return {
                    success: false,
                    error: "Click target not found."
                };
            }

            element.click();

            return {
                success: true,
                action: "click"
            };
        }


        case "type": {

            const element = getElement(action.selector);

            if (!element) {
                return {
                    success: false,
                    error: "Type target not found."
                };
            }

            element.focus();

            element.value = action.value || "";

            element.dispatchEvent(
                new Event("input", {
                    bubbles: true
                })
            );

            element.dispatchEvent(
                new Event("change", {
                    bubbles: true
                })
            );

            return {
                success: true,
                action: "type"
            };
        }


        case "scroll": {

            window.scrollBy({
                top: action.amount || 0,
                behavior: "smooth"
            });

            return {
                success: true,
                action: "scroll"
            };
        }


        case "wait": {

            return {
                success: true,
                action: "wait"
            };
        }


        case "noop": {

            return {
                success: true,
                action: "noop"
            };
        }


        default:

            return {
                success: false,
                error: `Unsupported action: ${action.action}`
            };
    }
}


// ------------------------------------------------------------
// MESSAGE LISTENER
// ------------------------------------------------------------

chrome.runtime.onMessage.addListener(
    (message, sender, sendResponse) => {

        if (!message || !message.type) {

            sendResponse({
                success: false,
                error: "Invalid message."
            });

            return;
        }


        // Return current page state
        if (message.type === "GET_PAGE_STATE") {

            const result = getPageState();

            sendResponse(result);

            return;
        }


        // Execute action approved by background/agent
        if (message.type === "EXECUTE_BROWSER_ACTION") {

            const result = executeBrowserAction(
                message.action
            );

            sendResponse(result);

            return;
        }


        sendResponse({
            success: false,
            error: "Unknown message type."
        });
    }
);
