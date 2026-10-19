try {
    importScripts("privacy-gate.js");
} catch (_) {}

const SERVER_URL = "http://127.0.0.1:8000";
const PRIVAGENT_AUTH_TOKEN = "privagent-local-token";

const MAX_STEPS = 6;
const STEP_DELAY_MS = 600;

const ALLOWED_ACTIONS = [
    "click",
    "type",
    "scroll",
    "navigate",
    "wait",
    "noop"
];


const CONSEQUENTIAL_KEYWORDS = [
    "pay", "transfer", "purchase", "buy", "order",
    "submit", "confirm", "delete", "remove", "book",
    "checkout", "withdraw", "deposit", "cancel", "terminate",
    "clear", "erase", "charge", "send"
];

function isConsequentialAction(action, elements = []) {
    if (!action || typeof action !== "object") return false;
    if (action.action === "navigate") return true;
    if (action.requires_confirmation === true) return true;

    const selectorLower = (action.selector || "").toLowerCase();
    for (const kw of CONSEQUENTIAL_KEYWORDS) {
        if (selectorLower.includes(kw)) {
            return true;
        }
    }

    const elementList = Array.isArray(elements)
        ? elements
        : (Array.isArray(elements?.elements) ? elements.elements : (Array.isArray(elements?.visible_controls) ? elements.visible_controls : []));

    if (action.selector && elementList.length > 0) {
        const targetElement = elementList.find(el => el.selector === action.selector);
        if (targetElement) {
            // 1. Structural / Semantic Form Submission Check (not keyword dependent)
            if (
                targetElement.isSubmit === true ||
                targetElement.subtype === "submit" ||
                targetElement.type === "submit"
            ) {
                return true;
            }

            // 2. Keyword Check on Label
            const labelLower = (targetElement.label || "").toLowerCase();
            for (const kw of CONSEQUENTIAL_KEYWORDS) {
                if (labelLower.includes(kw)) {
                    return true;
                }
            }
        }
    }

    return false;
}

function validateActionGrounded(action, pageState) {
    if (!action || typeof action !== "object") {
        return { allowed: false, reason: "Invalid action format." };
    }

    if (!ALLOWED_ACTIONS.includes(action.action)) {
        return { allowed: false, reason: `Blocked unsupported action: ${action.action}` };
    }

    if (action.action === "wait" || action.action === "noop") {
        return { allowed: true };
    }

    if (action.action === "navigate") {
        if (!action.url || !/^https?:\/\//i.test(action.url)) {
            return { allowed: false, reason: "Only HTTP/HTTPS navigation is allowed." };
        }
        return { allowed: true };
    }

    if (!action.selector) {
        return { allowed: false, reason: "Target selector is missing." };
    }

    const controls = Array.isArray(pageState?.elements)
        ? pageState.elements
        : (Array.isArray(pageState?.visible_controls) ? pageState.visible_controls : []);

    const elementExists = controls.some(el => el.selector === action.selector);

    if (!elementExists) {
        return {
            allowed: false,
            reason: `Stale or ungrounded target: Selector "${action.selector}" does not exist on page.`
        };
    }

    return { allowed: true };
}

// --------------------------------------------------
// PAGE STATE FINGERPRINTING & OBSERVABLE COMPLETION
// --------------------------------------------------

function getPageControls(pageState) {
    if (!pageState || typeof pageState !== "object") return [];
    if (Array.isArray(pageState.elements)) return pageState.elements;
    if (Array.isArray(pageState.visible_controls)) return pageState.visible_controls;
    return [];
}

function computePageStateFingerprint(pageState) {
    if (!pageState || typeof pageState !== "object") return "";
    const url = pageState.url || "";
    const title = (pageState.title || "").trim();
    const text = (pageState.text || "").replace(/\s+/g, " ").trim();
    const controls = getPageControls(pageState);

    // Semantic control fingerprinting: normalize volatile random IDs to ensure
    // we track genuine semantic state changes (labels, types, enabled flags)
    const elementsKey = controls.map(el => {
        const type = (el.type || "").toLowerCase();
        const subtype = (el.subtype || "").toLowerCase();
        const label = (el.label || "").trim().toLowerCase();
        const enabled = el.enabled !== false;
        const isSubmit = Boolean(el.isSubmit);
        const rawSelector = el.selector || "";
        const stableSelector = rawSelector.replace(/pa-[a-z0-9]+/g, "pa-id");
        return `${type}:${subtype}:${label}:${enabled}:${isSubmit}:${stableSelector}`;
    }).join(";");

    return `${url}::${title}::${text}::${elementsKey}`;
}

function isGoalCompleted(goal, pageState, history = []) {
    if (!goal || typeof goal !== "string") return false;
    const goalLower = goal.toLowerCase().trim();

    const controls = getPageControls(pageState);
    const pageText = (pageState?.text || "").toLowerCase();

    // 1. View Statement Goal: Check if statement is visibly loaded in controls or page text
    if (goalLower.includes("statement") && ["view", "click", "open", "show", "load"].some(w => goalLower.includes(w))) {
        for (const ctrl of controls) {
            const lbl = (ctrl.label || "").toLowerCase().trim();
            if (lbl.includes("statement loaded") || lbl === "statement loaded" || lbl.includes("hide statement")) {
                return true;
            }
        }
        if (pageText.includes("statement loaded") || (pageText.includes("account statement") && pageText.includes("salary credit"))) {
            return true;
        }
    }

    // 2. Single-Action Execution Outcome Check:
    // If an action was already executed in history and the page reflects completion
    const hasHistory = Array.isArray(history) && history.length > 0;
    if (hasHistory) {
        const isSingleClick = (
            goalLower.startsWith("click ") ||
            goalLower.startsWith("press ") ||
            goalLower.startsWith("tap ") ||
            goalLower.startsWith("open ")
        ) && ![" then ", " and ", " after "].some(kw => goalLower.includes(kw));

        if (isSingleClick) {
            for (const ctrl of controls) {
                const lbl = (ctrl.label || "").toLowerCase().trim();
                if (["loaded", "submitted", "success", "confirmed", "settled", "completed"].some(term => lbl.includes(term))) {
                    return true;
                }
            }
            if (["success", "completed successfully", "statement loaded"].some(term => pageText.includes(term))) {
                return true;
            }
        }
    }

    return false;
}

// --------------------------------------------------
// TASK SESSION & CONCURRENCY LOCK
// --------------------------------------------------

let currentTask = null;

function startTask(command) {
    if (currentTask && currentTask.status === "running") {
        return {
            success: false,
            error: "Another agent task is currently in progress."
        };
    }

    currentTask = {
        id: Date.now(),
        command: command || "",
        step: 0,
        status: "running",
        history: [],
        lastSignature: null,
        lastStateFingerprint: null,
        repeatCount: 0
    };

    return {
        success: true,
        taskId: currentTask.id
    };
}

function endTask(status = "completed") {
    if (currentTask) {
        currentTask.status = status;
        const taskInfo = { ...currentTask };
        currentTask = null;
        return { success: true, task: taskInfo };
    }
    return { success: true };
}


// ==================================================
// EXTENSION INSTALL
// ==================================================

if (typeof chrome !== "undefined" && chrome.runtime?.onInstalled) {
    chrome.runtime.onInstalled.addListener(() => {
        console.log("PrivAgent installed successfully.");
    });
}


// ==================================================
// MESSAGE HANDLER
// ==================================================

if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
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
                        console.error("Server check error:", error);
                        sendResponse({ success: false, error: error.message });
                    });
                return true;
            }


            // ------------------------------------------
            // START MULTI-STEP TASK
            // ------------------------------------------

            if (message.type === "START_TASK") {
                const res = startTask(message.command);
                sendResponse(res);
                return;
            }


            // ------------------------------------------
            // END MULTI-STEP TASK
            // ------------------------------------------

            if (message.type === "END_TASK") {
                const res = endTask(message.status);
                sendResponse(res);
                return;
            }


            // ------------------------------------------
            // RUN AGENT STEP (Multi-step loop)
            // ------------------------------------------

            if (message.type === "RUN_AGENT_STEP") {
                runAgentStep(message)
                    .then(sendResponse)
                    .catch(error => {
                        console.error("Agent step error:", error);
                        sendResponse({ success: false, error: error.message });
                    });
                return true;
            }


            // ------------------------------------------
            // RUN AGENT (Single turn backward-compatible)
            // ------------------------------------------

            if (message.type === "RUN_AGENT") {
                runAgent(message)
                    .then(sendResponse)
                    .catch(error => {
                        console.error("Agent error:", error);
                        sendResponse({ success: false, error: error.message });
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
                        console.error("Execution error:", error);
                        sendResponse({ success: false, error: error.message });
                    });
                return true;
            }


            sendResponse({
                success: false,
                error: "Unknown message type."
            });
        }
    );
}


// ==================================================
// SERVER HEALTH CHECK
// ==================================================

async function checkServer() {

    const response =
        await fetch(`${SERVER_URL}/health`, {
            headers: {
                "X-PrivAgent-Token": PRIVAGENT_AUTH_TOKEN
            }
        });


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

    let goal = (message.command || "").trim();
    if (typeof PrivAgentPrivacy !== "undefined" && typeof PrivAgentPrivacy.sanitizeText === "function") {
        goal = PrivAgentPrivacy.sanitizeText(goal);
    }

    const previousActions = Array.isArray(message.previousActions)
        ? message.previousActions
        : (Array.isArray(message.history)
            ? message.history
            : (currentTask?.history ? currentTask.history.map(h => h.action) : []));

    const context = {

        goal: goal,

        step: message.step || (currentTask ? currentTask.step : 1),

        history: previousActions,

        visible_controls:
            visibleControls,

        safe_labels:
            safeLabels,

        redacted_regions:
            [],

        action_candidates:
            []
    };


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
                        "application/json",
                    "X-PrivAgent-Token":
                        PRIVAGENT_AUTH_TOKEN
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


    const action = result.action;

    // 1. Goal Complete
    const isCompleted = action.action === "noop" || isGoalCompleted(message.command, page, message.history || message.previousActions);
    if (isCompleted) {
        if (currentTask) {
            currentTask.status = "completed";
            currentTask.lastSignature = null;
            currentTask.lastStateFingerprint = null;
            currentTask.repeatCount = 0;
        }
        return {
            success: true,
            isNoop: true,
            status: "completed",
            action: action.action === "noop" ? action : { action: "noop" },
            planner: result.planner,
            message: result.message || "Goal accomplished."
        };
    }

    // 2. Action Grounding & Stale Target Protection
    const validation = validateActionGrounded(action, page);
    if (!validation.allowed) {
        return {
            success: false,
            status: "failed",
            action: action,
            error: validation.reason
        };
    }

    // 3. Infinite Loop Detection
    const sig = `${action.action}:${action.selector || ""}:${action.value || ""}:${action.url || ""}`;
    const stateFingerprint = computePageStateFingerprint(page);

    if (!currentTask || currentTask.command !== message.command) {
        currentTask = {
            id: Date.now(),
            command: message.command,
            step: message.step || 1,
            lastSignature: sig,
            lastStateFingerprint: stateFingerprint,
            repeatCount: 0
        };
    } else {
        currentTask.step = message.step || (currentTask.step + 1);
        const isSameAction = sig === currentTask.lastSignature;
        const isStateUnchanged = currentTask.lastStateFingerprint !== null && stateFingerprint === currentTask.lastStateFingerprint;

        if (isSameAction && isStateUnchanged) {
            currentTask.repeatCount++;
            if (currentTask.repeatCount >= (action.action === "wait" ? 2 : 1)) {
                return {
                    success: false,
                    status: "failed",
                    action: action,
                    error: "Infinite loop detected: repeated identical action on unchanged state."
                };
            }
        } else {
            currentTask.lastSignature = sig;
            currentTask.lastStateFingerprint = stateFingerprint;
            currentTask.repeatCount = 0;
        }
    }

    // 4. Consequential Action Check
    const requiresConfirmation = isConsequentialAction(action, page.elements || page);

    // ==================================================
    // RETURN APPROVED ACTION TO POPUP
    // ==================================================

    return {
        success: true,
        action: action,
        isNoop: false,
        requiresConfirmation: requiresConfirmation,
        planner: result.planner,
        message: result.message || ""
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
// ==================================================
// GET FRESH SANITIZED PAGE STATE
// ==================================================

async function getFreshPageState() {

    const tabs = await chrome.tabs.query({
        active: true,
        currentWindow: true
    });

    if (!tabs.length) {
        throw new Error("No active tab found.");
    }

    const response = await chrome.tabs.sendMessage(
        tabs[0].id,
        {
            type: "GET_PAGE_STATE"
        }
    );

    if (!response || response.success === false) {
        throw new Error(
            response?.error ||
            "Could not capture page state."
        );
    }

    if (!response.pageState) {
        throw new Error(
            "Content script returned no page state."
        );
    }

    return response.pageState;
}


// ==================================================
// SMALL DELAY BETWEEN AGENT STEPS
// ==================================================

function delay(ms) {
    return new Promise(resolve => {
        setTimeout(resolve, ms);
    });
}


// ==================================================
// MULTI-STEP AGENT STEP HANDLER
// ==================================================

async function runAgentStep(message) {
    return runAgent(message);
}


// ==================================================
// BOUNDED MULTI-STEP AGENT LOOP ENGINE
// ==================================================

async function runBoundedAgentLoop({
    command,
    tabId = null,
    maxSteps = MAX_STEPS,
    stepDelayMs = STEP_DELAY_MS,
    getPageStateFn,
    planFn,
    executeActionFn,
    confirmFn = async () => true,
    onProgressFn = () => {}
}) {
    if (currentTask && currentTask.status === "running") {
        return {
            success: false,
            status: "failed",
            error: "Another agent task is currently in progress."
        };
    }

    currentTask = {
        id: Date.now(),
        command: command || "",
        step: 0,
        status: "running",
        history: [],
        lastSignature: null,
        lastStateFingerprint: null,
        repeatCount: 0
    };

    try {
        for (let step = 1; step <= maxSteps; step++) {
            currentTask.step = step;

            // 1. Capture Page State
            onProgressFn({
                step,
                maxSteps,
                status: "running",
                phase: "capture",
                message: `Step ${step}/${maxSteps}: Capturing sanitized page state...`
            });

            let pageState;
            try {
                pageState = await getPageStateFn(tabId);
            } catch (err) {
                return {
                    success: false,
                    status: "failed",
                    step,
                    history: currentTask.history,
                    error: "Could not capture page state: " + err.message
                };
            }

            if (!pageState || typeof pageState !== "object") {
                return {
                    success: false,
                    status: "failed",
                    step,
                    history: currentTask.history,
                    error: "Invalid page state captured."
                };
            }

            // 2. Plan Action
            onProgressFn({
                step,
                maxSteps,
                status: "running",
                phase: "planning",
                message: `Step ${step}/${maxSteps}: Planning next action...`
            });

            let planResult;
            try {
                let sanitizedGoal = command;
                if (typeof PrivAgentPrivacy !== "undefined" && typeof PrivAgentPrivacy.sanitizeText === "function") {
                    sanitizedGoal = PrivAgentPrivacy.sanitizeText(sanitizedGoal);
                }
                planResult = await planFn(sanitizedGoal, pageState, { step, history: currentTask.history });
            } catch (err) {
                return {
                    success: false,
                    status: "failed",
                    step,
                    history: currentTask.history,
                    error: "Planning failed: " + err.message
                };
            }

            const action = planResult?.action;
            if (!action || !action.action) {
                return {
                    success: false,
                    status: "failed",
                    step,
                    history: currentTask.history,
                    error: "Planner returned no action."
                };
            }

            // 3. Goal Completion Termination (noop or observable completion)
            const isCompleted = action.action === "noop" || isGoalCompleted(command, pageState, currentTask.history);
            if (isCompleted) {
                const finalAction = action.action === "noop" ? action : { action: "noop" };
                onProgressFn({
                    step,
                    maxSteps,
                    status: "completed",
                    phase: "completed",
                    action: finalAction,
                    message: "Goal completed."
                });
                return {
                    success: true,
                    status: "completed",
                    step,
                    history: currentTask.history,
                    action: finalAction,
                    message: "Goal completed."
                };
            }

            // 4. Grounding & Stale Target Validation
            const validation = validateActionGrounded(action, pageState);
            if (!validation.allowed) {
                return {
                    success: false,
                    status: "failed",
                    step,
                    history: currentTask.history,
                    action,
                    error: validation.reason
                };
            }

            // 5. Infinite Loop Detection
            const sig = `${action.action}:${action.selector || ""}:${action.value || ""}:${action.url || ""}`;
            const stateFingerprint = computePageStateFingerprint(pageState);
            const isSameAction = sig === currentTask.lastSignature;
            const isStateUnchanged = currentTask.lastStateFingerprint !== null && stateFingerprint === currentTask.lastStateFingerprint;

            if (isSameAction && isStateUnchanged) {
                currentTask.repeatCount++;
                if (currentTask.repeatCount >= (action.action === "wait" ? 2 : 1)) {
                    return {
                        success: false,
                        status: "failed",
                        step,
                        history: currentTask.history,
                        action,
                        error: "Infinite loop detected: repeated identical action on unchanged state."
                    };
                }
            } else {
                currentTask.lastSignature = sig;
                currentTask.lastStateFingerprint = stateFingerprint;
                currentTask.repeatCount = 0;
            }

            // 6. Consequential Action & Confirmation Gate
            const requiresConfirmation = isConsequentialAction(action, pageState.elements || pageState);
            if (requiresConfirmation) {
                onProgressFn({
                    step,
                    maxSteps,
                    status: "waiting_confirmation",
                    phase: "confirmation",
                    action,
                    message: `Step ${step}/${maxSteps}: Awaiting user authorization for ${action.action}...`
                });
                const approved = await confirmFn(action, pageState);
                if (!approved) {
                    return {
                        success: false,
                        status: "blocked",
                        step,
                        history: currentTask.history,
                        action,
                        reason: "Action rejected by user confirmation gate."
                    };
                }
            }

            // 7. Execute Action
            onProgressFn({
                step,
                maxSteps,
                status: "running",
                phase: "execution",
                action,
                message: `Step ${step}/${maxSteps}: Executing ${action.action}...`
            });

            let execResult;
            try {
                execResult = await executeActionFn(action, tabId);
            } catch (err) {
                return {
                    success: false,
                    status: "failed",
                    step,
                    history: currentTask.history,
                    action,
                    error: "Execution error: " + err.message
                };
            }

            if (!execResult || execResult.success === false) {
                return {
                    success: false,
                    status: "failed",
                    step,
                    history: currentTask.history,
                    action,
                    error: execResult?.error || "Browser action failed."
                };
            }

            currentTask.history.push({ step, action, result: execResult });

            // 8. Settle Delay before next step
            if (step < maxSteps) {
                await delay(stepDelayMs);
            }
        }

        return {
            success: false,
            status: "partially_completed",
            step: maxSteps,
            history: currentTask.history,
            message: `Maximum step limit (${maxSteps}) reached before goal completion.`
        };
    } finally {
        currentTask = null;
    }
}


// ==================================================
// MODULE EXPORTS (Node.js test compatibility)
// ==================================================

if (typeof module !== "undefined" && module.exports) {
    module.exports = {
        MAX_STEPS,
        STEP_DELAY_MS,
        ALLOWED_ACTIONS,
        CONSEQUENTIAL_KEYWORDS,
        isConsequentialAction,
        validateActionGrounded,
        getPageControls,
        computePageStateFingerprint,
        isGoalCompleted,
        startTask,
        endTask,
        runAgent,
        runAgentStep,
        runBoundedAgentLoop,
        delay
    };
}
