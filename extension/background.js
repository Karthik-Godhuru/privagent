const SERVER_URL = "http://127.0.0.1:8000";

const ALLOWED_ACTIONS = [
    "click",
    "type",
    "scroll",
    "navigate",
    "wait",
    "noop"
];


// ==================================================
// EXTENSION INSTALL
// ==================================================

chrome.runtime.onInstalled.addListener(() => {
    console.log("PrivAgent installed successfully.");
});


// ==================================================
// MESSAGE HANDLER
// ==================================================

chrome.runtime.onMessage.addListener(
    (message, sender, sendResponse) => {

        if (!message || !message.type) {
            sendResponse({
                success: false,
                error: "Invalid message."
            });

            return;
        }


        // ------------------------------------------
        // CHECK SERVER
        // ------------------------------------------

        if (message.type === "CHECK_SERVER") {

            checkServer()
                .then(sendResponse)
                .catch(error => {

                    console.error(
                        "Server check error:",
                        error
                    );

                    sendResponse({
                        success: false,
                        error: error.message
                    });
                });

            return true;
        }


        // ------------------------------------------
        // RUN AGENT
        // ------------------------------------------

        if (message.type === "RUN_AGENT") {

            runAgent(message)
                .then(sendResponse)
                .catch(error => {

                    console.error(
                        "Agent error:",
                        error
                    );

                    sendResponse({
                        success: false,
                        error: error.message
                    });
                });

            return true;
        }


        // ------------------------------------------
        // EXECUTE ACTION
        // ------------------------------------------

        if (message.type === "EXECUTE_ACTION") {

            executeAction(message.action)
                .then(sendResponse)
                .catch(error => {

                    console.error(
                        "Execution error:",
                        error
                    );

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
    }
);


// ==================================================
// SERVER HEALTH CHECK
// ==================================================

async function checkServer() {

    const response =
        await fetch(`${SERVER_URL}/health`);


    if (!response.ok) {
        throw new Error(
            `Server returned ${response.status}`
        );
    }


    const data =
        await response.json();


    return {
        success: true,
        server: data
    };
}


// ==================================================
// RUN PRIVAGENT
// ==================================================

async function runAgent(message) {

    // ----------------------------------------------
    // VALIDATE COMMAND
    // ----------------------------------------------

    if (
        !message.command ||
        typeof message.command !== "string"
    ) {

        throw new Error(
            "Agent command is required."
        );
    }


    // ----------------------------------------------
    // VALIDATE SANITIZED CONTEXT
    // ----------------------------------------------

    if (
        !message.sanitizedContext ||
        typeof message.sanitizedContext !== "object"
    ) {

        throw new Error(
            "Sanitized context is required."
        );
    }


    const page =
        message.sanitizedContext;


    // ==================================================
    // CONVERT PAGE ELEMENTS INTO SERVER FORMAT
    // ==================================================

    const visibleControls =
        Array.isArray(page.elements)
            ? page.elements.map(element => {

                return {

                    type:
                        element.type ||
                        "unknown",

                    label:
                        element.label ||
                        "",

                    selector:
                        element.selector ||
                        null,

                    enabled:
                        element.enabled !== false
                };

            })
            : [];


    // ==================================================
    // SAFE LABELS
    // ==================================================

    const safeLabels = [];


    if (page.title) {

        safeLabels.push({

            text:
                page.title,

            role:
                "page_title",

            selector:
                null
        });
    }


    // ==================================================
    // BUILD EXACT SanitizedContext EXPECTED BY FASTAPI
    // ==================================================

    const context = {

        goal:
            message.command.trim(),

        visible_controls:
            visibleControls,

        safe_labels:
            safeLabels,

        redacted_regions:
            [],

        action_candidates:
            []
    };


    console.log(
        "PrivAgent sanitized request:",
        context
    );


    // ==================================================
    // SEND SANITIZED CONTEXT TO SERVER
    // ==================================================

    const response =
        await fetch(
            `${SERVER_URL}/agent`,
            {

                method: "POST",

                headers: {
                    "Content-Type":
                        "application/json"
                },

                body:
                    JSON.stringify(context)
            }
        );


    // ==================================================
    // HANDLE SERVER ERRORS
    // ==================================================

    if (!response.ok) {

        let errorMessage =
            `Server returned ${response.status}`;


        try {

            const errorData =
                await response.json();


            if (errorData.detail) {

                if (
                    typeof errorData.detail ===
                    "string"
                ) {

                    errorMessage =
                        errorData.detail;

                } else {

                    errorMessage =
                        JSON.stringify(
                            errorData.detail,
                            null,
                            2
                        );
                }
            }

        } catch (error) {

            console.error(
                "Could not parse server error:",
                error
            );
        }


        throw new Error(
            errorMessage
        );
    }


    // ==================================================
    // READ SERVER RESPONSE
    // ==================================================

    const result =
        await response.json();


    console.log(
        "PrivAgent server response:",
        result
    );


    // ==================================================
    // VALIDATE SERVER RESPONSE
    // ==================================================

    if (!result.action) {

        throw new Error(
            "Server returned no action."
        );
    }


    if (
        !result.action.action ||
        !ALLOWED_ACTIONS.includes(
            result.action.action
        )
    ) {

        throw new Error(
            `Blocked unsupported action: ${
                result.action.action ||
                "unknown"
            }`
        );
    }


    // ==================================================
    // RETURN APPROVED ACTION TO POPUP
    // ==================================================

    return {

        success: true,

        message:
            result.message || "",

        action:
            result.action,

        requiresConfirmation:
            result.action
                .requires_confirmation === true
    };
}


// ==================================================
// EXECUTE APPROVED ACTION
// ==================================================

async function executeAction(action) {

    // ----------------------------------------------
    // VALIDATE ACTION
    // ----------------------------------------------

    if (
        !action ||
        !action.action
    ) {

        throw new Error(
            "Invalid action."
        );
    }


    if (
        !ALLOWED_ACTIONS.includes(
            action.action
        )
    ) {

        throw new Error(
            `Blocked unsupported action: ${action.action}`
        );
    }


    // ==================================================
    // NAVIGATION
    // ==================================================

    if (action.action === "navigate") {

        if (!action.url) {

            throw new Error(
                "Navigation URL is missing."
            );
        }


        if (
            !/^https?:\/\//i.test(
                action.url
            )
        ) {

            throw new Error(
                "Only HTTP/HTTPS navigation is allowed."
            );
        }


        const tabs =
            await chrome.tabs.query({
                active: true,
                currentWindow: true
            });


        if (!tabs.length) {

            throw new Error(
                "No active tab found."
            );
        }


        await chrome.tabs.update(
            tabs[0].id,
            {
                url:
                    action.url
            }
        );


        return {
            success: true,
            action: "navigate"
        };
    }


    // ==================================================
    // NOOP
    // ==================================================

    if (action.action === "noop") {

        return {
            success: true,
            action: "noop"
        };
    }


    // ==================================================
    // WAIT
    // ==================================================

    if (action.action === "wait") {

        return {
            success: true,
            action: "wait"
        };
    }


    // ==================================================
    // FIND ACTIVE TAB
    // ==================================================

    const tabs =
        await chrome.tabs.query({
            active: true,
            currentWindow: true
        });


    if (!tabs.length) {

        throw new Error(
            "No active tab found."
        );
    }


    const tabId =
        tabs[0].id;


    // ==================================================
    // SEND ACTION TO CONTENT.JS
    // ==================================================

    const result =
        await chrome.tabs.sendMessage(
            tabId,
            {

                type:
                    "EXECUTE_BROWSER_ACTION",

                action:
                    action
            }
        );


    if (!result) {

        throw new Error(
            "No response from browser executor."
        );
    }


    if (result.success === false) {

        throw new Error(
            result.error ||
            "Browser action failed."
        );
    }


    return result;
}
