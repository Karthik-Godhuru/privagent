// ============================================================
// PRIVAGENT CONTENT SCRIPT
// ============================================================

console.log("PrivAgent content script loaded.");


// ------------------------------------------------------------
// PAGE STATE
// ------------------------------------------------------------

function getPageState() {

    const elements = findInteractiveElements();

    const rawPageState = {
        title: document.title,
        url: window.location.href,
        text: document.body?.innerText || "",
        elements: elements
    };

    // Keep raw page data inside the browser.
    // Only sanitized data is returned.
    if (
        typeof PrivAgentPrivacy === "undefined" ||
        typeof PrivAgentPrivacy.sanitizePageState !== "function"
    ) {
        console.error("PrivAgent Privacy Gate is not available.");

        return {
            title: "",
            url: "",
            text: "",
            elements: []
        };
    }

    return PrivAgentPrivacy.sanitizePageState(rawPageState);
}

// ------------------------------------------------------------
// SENSITIVE INPUT TYPES — never read .value from these
// ------------------------------------------------------------

// These input types can hold live secrets typed by the user.
// We allow only static metadata (aria-label, placeholder) so
// no secret ever enters the page-state that travels to the server.
const SENSITIVE_INPUT_TYPES = new Set([
    "password", // login / PIN fields
    "hidden",   // CSRF tokens, session IDs, internal state
    "tel",      // phone / OTP fields on banking forms
]);


// ------------------------------------------------------------
// FIND INTERACTIVE ELEMENTS
// ------------------------------------------------------------

function findInteractiveElements() {

    const elements = document.querySelectorAll(
        "button, input, select, textarea, a"
    );

    return Array.from(elements).map((element, index) => {

        // For sensitive input types read only static metadata —
        // never the live value the user has typed.
        const isSensitive =
            element.tagName === "INPUT" &&
            SENSITIVE_INPUT_TYPES.has(
                (element.type || "").toLowerCase()
            );

        return {
            id: `element_${index}`,

            type: element.tagName.toLowerCase(),

            label:
                element.innerText ||
                element.getAttribute("aria-label") ||
                element.getAttribute("placeholder") ||
                (isSensitive ? "" : element.value) ||
                "",

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

            sendResponse({
                success: true,
                pageState: getPageState()
            });

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
