const SERVER_URL = "http://127.0.0.1:8000";

const ALLOWED_ACTIONS = [
    "click",
    "type",
    "scroll",
    "navigate",
    "wait",
    "noop"
];

chrome.runtime.onInstalled.addListener(() => {
    console.log("PrivAgent installed successfully.");
});


// --------------------------------------------------
// MESSAGE HANDLER
// --------------------------------------------------

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

    if (!message || !message.type) {
        sendResponse({
            success: false,
            error: "Invalid message."
        });
        return;
    }

    // Check server status
    if (message.type === "CHECK_SERVER") {
        checkServer()
            .then(sendResponse)
            .catch(error => {
                sendResponse({
                    success: false,
                    error: error.message
                });
            });

        return true;
    }


    // Send sanitized context to PrivAgent server
    if (message.type === "RUN_AGENT") {

        runAgent(message)
            .then(sendResponse)
            .catch(error => {
                console.error("Agent error:", error);

                sendResponse({
                    success: false,
                    error: error.message
                });
            });

        return true;
    }


    // Execute an approved action on the current tab
    if (message.type === "EXECUTE_ACTION") {

        executeAction(message.action)
            .then(sendResponse)
            .catch(error => {
                console.error("Execution error:", error);

                sendResponse({
                    success: false,
                    error: error.message
                });
            });

        return true;
    }


    sendResponse({
        success: false,
        error: "Unknown message type."
    });
});


// --------------------------------------------------
// SERVER HEALTH CHECK
// --------------------------------------------------

async function checkServer() {

    const response = await fetch(`${SERVER_URL}/health`);

    if (!response.ok) {
        throw new Error(`Server returned ${response.status}`);
    }

    const data = await response.json();

    return {
        success: true,
        server: data
    };
}


// --------------------------------------------------
// RUN AGENT
// --------------------------------------------------

async function runAgent(message) {

    if (!message.command) {
        throw new Error("Agent command is required.");
    }

    if (!message.sanitizedContext) {
        throw new Error("Sanitized context is required.");
    }


    // IMPORTANT:
    // Only sanitized context should be sent to the server.
    const context = {
        ...message.sanitizedContext,
        goal: message.command
    };


    const response = await fetch(`${SERVER_URL}/agent`, {
        method: "POST",

        headers: {
            "Content-Type": "application/json"
        },

        body: JSON.stringify(context)
    });


    if (!response.ok) {

        let errorMessage = `Server returned ${response.status}`;

        try {
            const errorData = await response.json();

            if (errorData.detail) {
                errorMessage = errorData.detail;
            }

        } catch (_) {
            // Keep default error message
        }

        throw new Error(errorMessage);
    }


    const result = await response.json();


    // Validate the server response before allowing execution.
    if (!result.action) {
        throw new Error("Server returned no action.");
    }


    if (!ALLOWED_ACTIONS.includes(result.action.action)) {
        throw new Error(
            `Blocked unsupported action: ${result.action.action}`
        );
    }


    return {
        success: true,
        message: result.message,
        action: result.action,
        requiresConfirmation:
            result.action.requires_confirmation === true
    };
}


// --------------------------------------------------
// EXECUTE APPROVED ACTION
// --------------------------------------------------

async function executeAction(action) {

    if (!action || !action.action) {
        throw new Error("Invalid action.");
    }


    if (!ALLOWED_ACTIONS.includes(action.action)) {
        throw new Error(
            `Blocked unsupported action: ${action.action}`
        );
    }


    // Navigation is handled by the background service worker.
    if (action.action === "navigate") {

        if (!action.url) {
            throw new Error("Navigation URL is missing.");
        }

        if (!/^https?:\/\//i.test(action.url)) {
            throw new Error("Only HTTP/HTTPS navigation is allowed.");
        }

        const tabs = await chrome.tabs.query({
            active: true,
            currentWindow: true
        });

        if (!tabs.length) {
            throw new Error("No active tab found.");
        }

        await chrome.tabs.update(tabs[0].id, {
            url: action.url
        });

        return {
            success: true,
            action: "navigate"
        };
    }


    // No browser action required.
    if (action.action === "noop") {
        return {
            success: true,
            action: "noop"
        };
    }


    if (action.action === "wait") {
        return {
            success: true,
            action: "wait"
        };
    }


    // Other actions are sent to content.js.
    const tabs = await chrome.tabs.query({
        active: true,
        currentWindow: true
    });

    if (!tabs.length) {
        throw new Error("No active tab found.");
    }


    const tabId = tabs[0].id;


    const result = await chrome.tabs.sendMessage(
        tabId,
        {
            type: "EXECUTE_BROWSER_ACTION",
            action
        }
    );


    return result;
}
