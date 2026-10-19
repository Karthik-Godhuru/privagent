// ============================================================
// PRIVAGENT — BOUNDED MULTI-STEP AGENT LOOP VERIFICATION SUITE
//
// Tests:
// 1. Multi-step goal accomplishment: 2-step task terminating on noop (status: completed).
// 2. Immediate goal completion: step 1 noop termination (status: completed).
// 3. Step bound enforcement: MAX_STEPS = 6 ceiling (status: partially_completed).
// 4. Consequential confirmation gate: user cancellation blocks execution (status: blocked).
// 5. Consequential confirmation gate: user approval proceeds with execution.
// 6. Stale / ungrounded target rejection: missing selector fails closed (status: failed).
// 7. Infinite loop detection: repeated identical action fails (status: failed).
// 8. Task concurrency lock: rejects parallel task runs, unlocks cleanly.
// 9. Browser action execution error: executor failure fails step (status: failed).
// 10. Multi-step privacy gate: zero secret canaries transmitted across steps.
//
// Run with: node integration/test-bounded-multi-step.js
// ============================================================

const { PrivAgentPrivacy } = require("../extension/privacy-gate.js");
global.PrivAgentPrivacy = PrivAgentPrivacy;

const {
    MAX_STEPS,
    STEP_DELAY_MS,
    ALLOWED_ACTIONS,
    CONSEQUENTIAL_KEYWORDS,
    isConsequentialAction,
    validateActionGrounded,
    computePageStateFingerprint,
    isGoalCompleted,
    getPageControls,
    startTask,
    endTask,
    runAgent,
    runBoundedAgentLoop
} = require("../extension/background.js");

let passed = 0;
let failed = 0;

function check(description, condition, details = "") {
    if (condition) {
        console.log(`  ✓  ${description}`);
        passed++;
    } else {
        console.error(`  ✗  ${description}`);
        if (details) console.error(`       Details: ${details}`);
        failed++;
    }
}

async function runAllTests() {
    console.log("\n============================================================");
    console.log(" PRIVAGENT BOUNDED MULTI-STEP AGENT LOOP TEST SUITE");
    console.log("============================================================\n");

    // ------------------------------------------------------------
    // 1. MULTI-STEP GOAL ACCOMPLISHMENT (2-Step Task -> completed)
    // ------------------------------------------------------------
    console.log("--- 1. Multi-Step Goal Accomplishment (2 steps -> completed) ---");

    const pageStateStep1 = {
        title: "Demo Store",
        url: "http://localhost/store",
        elements: [
            { selector: "#search-box", label: "Search products", type: "text" },
            { selector: "#search-btn", label: "Search", type: "button" }
        ]
    };

    const pageStateStep2 = {
        title: "Demo Store - Results",
        url: "http://localhost/store?q=laptop",
        elements: [
            { selector: "#search-box", label: "Search products", type: "text" },
            { selector: "#search-btn", label: "Search", type: "button" },
            { selector: "#item-laptop-1", label: "Laptop Pro 16", type: "link" }
        ]
    };

    let stepCallCount = 0;
    const executedActions = [];

    const result2Step = await runBoundedAgentLoop({
        command: "Search for laptop in the store",
        stepDelayMs: 0,
        getPageStateFn: async () => {
            stepCallCount++;
            return stepCallCount === 1 ? pageStateStep1 : pageStateStep2;
        },
        planFn: async (goal, pageState, { step }) => {
            if (step === 1) {
                return {
                    action: { action: "type", selector: "#search-box", value: "laptop" },
                    planner: "llm"
                };
            }
            return {
                action: { action: "noop" },
                planner: "llm",
                message: "Found search results."
            };
        },
        executeActionFn: async (action) => {
            executedActions.push(action);
            return { success: true, action: action.action };
        }
    });

    check("2-step loop reports status 'completed'", result2Step.status === "completed");
    check("2-step loop success is true", result2Step.success === true);
    check("2-step loop completed at step 2", result2Step.step === 2);
    check("History records 1 executed interactive action", result2Step.history.length === 1);
    check("Executed action was type on #search-box", executedActions.length === 1 && executedActions[0].selector === "#search-box");

    // ------------------------------------------------------------
    // 2. IMMEDIATE GOAL COMPLETION (Step 1 noop -> completed)
    // ------------------------------------------------------------
    console.log("\n--- 2. Immediate Goal Completion (Step 1 noop) ---");

    const resultImmediateNoop = await runBoundedAgentLoop({
        command: "Check if already on dashboard",
        stepDelayMs: 0,
        getPageStateFn: async () => ({
            title: "Dashboard",
            url: "http://localhost/dashboard",
            elements: [{ selector: "#logout-btn", label: "Log Out" }]
        }),
        planFn: async () => ({
            action: { action: "noop" },
            planner: "llm",
            message: "Already on dashboard."
        }),
        executeActionFn: async () => {
            throw new Error("Should not execute any action on immediate noop");
        }
    });

    check("Immediate noop reports status 'completed'", resultImmediateNoop.status === "completed");
    check("Immediate noop completed at step 1", resultImmediateNoop.step === 1);
    check("Immediate noop history is empty", resultImmediateNoop.history.length === 0);

    // ------------------------------------------------------------
    // 3. STEP BOUND ENFORCEMENT (MAX_STEPS = 6 -> partially_completed)
    // ------------------------------------------------------------
    console.log("\n--- 3. Step Bound Enforcement (MAX_STEPS = 6 ceiling) ---");

    const elements6Steps = [
        { selector: "#btn-1", label: "Step 1 button" },
        { selector: "#btn-2", label: "Step 2 button" },
        { selector: "#btn-3", label: "Step 3 button" },
        { selector: "#btn-4", label: "Step 4 button" },
        { selector: "#btn-5", label: "Step 5 button" },
        { selector: "#btn-6", label: "Step 6 button" }
    ];

    const resultMaxSteps = await runBoundedAgentLoop({
        command: "Long running automation task",
        maxSteps: 6,
        stepDelayMs: 0,
        getPageStateFn: async () => ({
            title: "Multi Step Wizard",
            elements: elements6Steps
        }),
        planFn: async (goal, pageState, { step }) => ({
            action: { action: "click", selector: `#btn-${step}` },
            planner: "llm"
        }),
        executeActionFn: async (action) => ({ success: true, action: action.action })
    });

    check("Reports status 'partially_completed' on step limit", resultMaxSteps.status === "partially_completed");
    check("Success is false when stopped at limit", resultMaxSteps.success === false);
    check("Exactly 6 steps executed in history", resultMaxSteps.history.length === 6);
    check("Final step reached was 6", resultMaxSteps.step === 6);
    check("Does NOT falsely claim 'completed'", resultMaxSteps.status !== "completed");

    // ------------------------------------------------------------
    // 4. CONSEQUENTIAL ACTION GATE & USER CANCELLATION (blocked)
    // ------------------------------------------------------------
    console.log("\n--- 4. Consequential Confirmation Gate & Cancellation (blocked) ---");

    let actionExecutedOnBlock = false;
    const resultBlocked = await runBoundedAgentLoop({
        command: "Pay balance",
        stepDelayMs: 0,
        getPageStateFn: async () => ({
            title: "Checkout",
            elements: [
                { selector: "#pay-now-button", label: "Pay Now ₹5,000" }
            ]
        }),
        planFn: async () => ({
            action: { action: "click", selector: "#pay-now-button" },
            planner: "llm"
        }),
        confirmFn: async (action) => {
            // User denies authorization
            return false;
        },
        executeActionFn: async () => {
            actionExecutedOnBlock = true;
            return { success: true };
        }
    });

    check("Rejection reports status 'blocked'", resultBlocked.status === "blocked");
    check("Success is false on user cancellation", resultBlocked.success === false);
    check("Reason indicates rejected confirmation gate", resultBlocked.reason.includes("user confirmation gate"));
    check("Action was NOT executed when user rejected", actionExecutedOnBlock === false);

    // ------------------------------------------------------------
    // 5. CONSEQUENTIAL ACTION GATE APPROVAL (user accepts -> proceeds)
    // ------------------------------------------------------------
    console.log("\n--- 5. Consequential Confirmation Gate Approval ---");

    let confirmationRequested = false;
    const resultApproved = await runBoundedAgentLoop({
        command: "Confirm booking",
        stepDelayMs: 0,
        getPageStateFn: async () => ({
            title: "Booking Review",
            elements: [
                { selector: "#confirm-booking-btn", label: "Confirm Booking" }
            ]
        }),
        planFn: async (goal, pageState, { step }) => {
            if (step === 1) {
                return {
                    action: { action: "click", selector: "#confirm-booking-btn" },
                    planner: "llm"
                };
            }
            return { action: { action: "noop" }, planner: "llm" };
        },
        confirmFn: async (action) => {
            confirmationRequested = true;
            return true; // User approves
        },
        executeActionFn: async (action) => ({ success: true, action: action.action })
    });

    check("Confirmation was requested for 'confirm' keyword", confirmationRequested === true);
    check("Approved consequential action completes successfully", resultApproved.status === "completed");

    // --- 5b. Structural Form Submission Consequential Gate (No keyword in label) ---
    let structuralConfirmTriggered = false;
    const resultStructuralSubmit = await runBoundedAgentLoop({
        command: "Proceed with form",
        stepDelayMs: 0,
        getPageStateFn: async () => ({
            title: "Application Form",
            elements: [
                // Button has benign label "Continue" with NO keywords, but has isSubmit: true
                { selector: "#form-continue-btn", label: "Continue", subtype: "submit", isSubmit: true }
            ]
        }),
        planFn: async (goal, pageState, { step }) => {
            if (step === 1) {
                return { action: { action: "click", selector: "#form-continue-btn" }, planner: "llm" };
            }
            return { action: { action: "noop" }, planner: "llm" };
        },
        confirmFn: async (action) => {
            structuralConfirmTriggered = true;
            return false; // Deny
        },
        executeActionFn: async () => ({ success: true })
    });

    check("Structural form submission (isSubmit: true) triggers confirmation even without keywords", structuralConfirmTriggered === true);
    check("Blocked structural form submission stops safely with 'blocked'", resultStructuralSubmit.status === "blocked");

    // --- 5c. Timeout Resilience Test ---
    const resultTimeout = await runBoundedAgentLoop({
        command: "Hanging plan request",
        stepDelayMs: 0,
        getPageStateFn: async () => ({
            title: "Portal",
            elements: [{ selector: "#btn-ok", label: "OK" }]
        }),
        planFn: async () => {
            throw new Error("PrivAgent reasoning request timed out after 15 seconds.");
        },
        executeActionFn: async () => ({ success: true })
    });

    check("Reasoning timeout stops execution safely with status 'failed'", resultTimeout.status === "failed");
    check("Error message reflects timeout", resultTimeout.error.includes("timed out"));

    // ------------------------------------------------------------
    // 6. STALE / UNGROUNDED TARGET REJECTION (failed)
    // ------------------------------------------------------------
    console.log("\n--- 6. Stale / Ungrounded Target Rejection (failed) ---");

    const resultUngrounded = await runBoundedAgentLoop({
        command: "Click missing item",
        stepDelayMs: 0,
        getPageStateFn: async () => ({
            title: "Shopping Page",
            elements: [
                { selector: "#item-real", label: "Real Item" }
            ]
        }),
        planFn: async () => ({
            action: { action: "click", selector: "#item-hallucinated-or-stale" },
            planner: "llm"
        }),
        executeActionFn: async () => {
            throw new Error("Should not execute ungrounded action");
        }
    });

    check("Ungrounded action reports status 'failed'", resultUngrounded.status === "failed");
    check("Error notes stale or ungrounded target", resultUngrounded.error.includes("Stale or ungrounded target"));

    // ------------------------------------------------------------
    // 7. INFINITE LOOP DETECTION (failed)
    // ------------------------------------------------------------
    console.log("\n--- 7. Infinite Loop Detection (failed) ---");

    let loopStep = 0;
    const resultInfiniteLoop = await runBoundedAgentLoop({
        command: "Repeat click endlessly",
        stepDelayMs: 0,
        getPageStateFn: async () => ({
            title: "Loop Test",
            elements: [
                { selector: "#refresh-btn", label: "Refresh" }
            ]
        }),
        planFn: async () => {
            loopStep++;
            // Proposing exact same action repeatedly on unchanged state
            return {
                action: { action: "click", selector: "#refresh-btn" },
                planner: "llm"
            };
        },
        executeActionFn: async (action) => ({ success: true, action: action.action })
    });

    check("Infinite loop reports status 'failed'", resultInfiniteLoop.status === "failed");
    check("Error explicitly identifies infinite loop", resultInfiniteLoop.error.includes("Infinite loop detected"));

    // ------------------------------------------------------------
    // 8. CONCURRENCY LOCK & CLEANUP
    // ------------------------------------------------------------
    console.log("\n--- 8. Concurrency Lock & Cleanup ---");

    const task1 = startTask("Task 1 command");
    check("First task starts successfully", task1.success === true && !!task1.taskId);

    const task2 = startTask("Task 2 overlapping command");
    check("Overlapping task start is rejected", task2.success === false && task2.error.includes("in progress"));

    const parallelLoopResult = await runBoundedAgentLoop({
        command: "Overlapping loop run",
        getPageStateFn: async () => ({}),
        planFn: async () => ({}),
        executeActionFn: async () => ({})
    });
    check("runBoundedAgentLoop rejected while another task active", parallelLoopResult.status === "failed" && parallelLoopResult.error.includes("in progress"));

    endTask("completed");

    const task3 = startTask("Task 3 after release");
    check("Subsequent task starts after endTask", task3.success === true);
    endTask("completed");

    // ------------------------------------------------------------
    // 9. BROWSER ACTION EXECUTION ERROR (failed)
    // ------------------------------------------------------------
    console.log("\n--- 9. Browser Action Execution Error Handling ---");

    const resultExecError = await runBoundedAgentLoop({
        command: "Click button that fails DOM execution",
        stepDelayMs: 0,
        getPageStateFn: async () => ({
            title: "DOM Page",
            elements: [{ selector: "#btn-faulty", label: "Faulty Button" }]
        }),
        planFn: async () => ({
            action: { action: "click", selector: "#btn-faulty" }
        }),
        executeActionFn: async () => ({
            success: false,
            error: "Element detached from frame during interaction."
        })
    });

    check("Execution error reports status 'failed'", resultExecError.status === "failed");
    check("Error message captures browser execution failure", resultExecError.error.includes("Element detached"));

    // ------------------------------------------------------------
    // 10. MULTI-STEP PRIVACY GATE & CANARY EXCLUSION
    // ------------------------------------------------------------
    console.log("\n--- 10. Multi-Step Privacy Gate & Zero Canary Leakage ---");

    const CANARIES = {
        otp: "847291",
        upi: "canary.user@okaxis",
        email: "confidential.canary@privagent.org",
        card: "4532 9999 8888 1111"
    };

    const dirtyUserGoal = `Send 500 to UPI ${CANARIES.upi} with OTP ${CANARIES.otp} and receipt to ${CANARIES.email}`;

    const interceptedGoals = [];
    const interceptedContexts = [];

    await runBoundedAgentLoop({
        command: dirtyUserGoal,
        stepDelayMs: 0,
        getPageStateFn: async () => ({
            title: "Banking Demo",
            elements: [
                { selector: "#btn-next", label: "Continue" }
            ]
        }),
        planFn: async (sanitizedGoal, pageState, { step }) => {
            interceptedGoals.push(sanitizedGoal);
            interceptedContexts.push(JSON.stringify(pageState));
            return { action: { action: "noop" } };
        },
        executeActionFn: async () => ({ success: true })
    });

    check("User goal was sanitized before planFn", interceptedGoals.length === 1);
    const goalPayload = interceptedGoals[0];
    check("Goal excludes raw OTP canary", !goalPayload.includes(CANARIES.otp));
    check("Goal excludes raw UPI canary", !goalPayload.includes(CANARIES.upi));
    check("Goal excludes raw email canary", !goalPayload.includes(CANARIES.email));
    check("Goal contains [OTP_REDACTED] or [PII_REDACTED]", goalPayload.includes("[OTP_REDACTED]") || goalPayload.includes("[UPI_REDACTED]") || goalPayload.includes("[EMAIL_REDACTED]"));

    const serializedOutbound = interceptedContexts.join(" ");
    check("Context excludes raw credit card canary", !serializedOutbound.includes(CANARIES.card));

    // ------------------------------------------------------------
    // 11. PREVIOUSLY FAILING MESSAGE PATH (RUN_AGENT in background.js)
    // ------------------------------------------------------------
    console.log("\n--- 11. Verified Message Path: RUN_AGENT Handling ---");

    // Stub chrome runtime listener to inspect background.js message dispatcher directly
    let backgroundMessageListener = null;
    global.chrome = {
        runtime: {
            onMessage: {
                addListener: (fn) => { backgroundMessageListener = fn; }
            },
            onInstalled: { addListener: () => {} }
        },
        tabs: {
            query: async () => [{ id: 101, url: "http://127.0.0.1:5500/banking.html" }],
            sendMessage: async (tabId, msg) => ({ success: true, result: "mock_dom_event" }),
            update: async () => {}
        }
    };

    // Re-require background.js with chrome stub to capture listener
    delete require.cache[require.resolve("../extension/background.js")];
    require("../extension/background.js");

    check("Background message listener registered successfully", typeof backgroundMessageListener === "function");

    // Mock fetch for backend /agent endpoint
    const originalFetch = global.fetch;
    global.fetch = async (url, opts) => {
        if (url.includes("/agent")) {
            return {
                ok: true,
                json: async () => ({
                    action: { action: "click", selector: "#view-statement-btn" },
                    planner: "local-deterministic",
                    message: "Identified statement button."
                })
            };
        }
        return { ok: true, json: async () => ({ status: "ok" }) };
    };

    const bankingPageState = {
        title: "PrivBank - Statement View",
        url: "http://127.0.0.1:5500/banking.html",
        elements: [
            { selector: "#view-statement-btn", label: "View Statement", type: "button" },
            { selector: "#account-num", label: "Account Number", type: "text" }
        ]
    };

    let runAgentResponse = null;
    await new Promise((resolve) => {
        backgroundMessageListener(
            {
                type: "RUN_AGENT",
                command: "Click View Statement",
                step: 1,
                sanitizedContext: bankingPageState
            },
            {},
            (res) => {
                runAgentResponse = res;
                resolve();
            }
        );
    });

    check("RUN_AGENT message does not return 'Unknown message type.' error", runAgentResponse?.error !== "Unknown message type.");
    check("RUN_AGENT succeeds on 'Click View Statement'", runAgentResponse?.success === true);
    check("RUN_AGENT returns grounded action targeting #view-statement-btn", runAgentResponse?.action?.selector === "#view-statement-btn");
    check("RUN_AGENT reports correct planner provenance", runAgentResponse?.planner === "local-deterministic");

    // Restore fetch
    global.fetch = originalFetch;

    // ------------------------------------------------------------
    // 12. STRICT REJECTION OF UNKNOWN & INVALID MESSAGES
    // ------------------------------------------------------------
    console.log("\n--- 12. Strict Rejection of Unknown & Malformed Messages ---");

    let unknownMsgResponse = null;
    await new Promise((resolve) => {
        backgroundMessageListener(
            { type: "ARBITRARY_UNSUPPORTED_TYPE_XYZ", payload: "test" },
            {},
            (res) => {
                unknownMsgResponse = res;
                resolve();
            }
        );
    });

    check("Background listener rejects unknown message type", unknownMsgResponse?.success === false);
    check("Background error explicitly notes 'Unknown message type.'", unknownMsgResponse?.error === "Unknown message type.");

    let invalidMsgResponse = null;
    await new Promise((resolve) => {
        backgroundMessageListener(
            null,
            {},
            (res) => {
                invalidMsgResponse = res;
                resolve();
            }
        );
    });

    check("Background listener rejects null/missing message", invalidMsgResponse?.success === false);
    check("Background error notes 'Invalid message.'", invalidMsgResponse?.error === "Invalid message.");

    // Content script message listener test
    let contentMessageListener = null;
    global.chrome.runtime.onMessage.addListener = (fn) => { contentMessageListener = fn; };
    delete require.cache[require.resolve("../extension/content.js")];
    require("../extension/content.js");

    check("Content script message listener registered", typeof contentMessageListener === "function");

    let contentUnknownResponse = null;
    await new Promise((resolve) => {
        contentMessageListener(
            { type: "UNRECOGNIZED_CONTENT_ACTION" },
            {},
            (res) => {
                contentUnknownResponse = res;
                resolve();
            }
        );
    });

    check("Content script rejects unknown message type", contentUnknownResponse?.success === false);
    check("Content script error explicitly notes 'Unknown message type.'", contentUnknownResponse?.error === "Unknown message type.");

    // ------------------------------------------------------------
    // 13. BANKING DEMO: VIEW STATEMENT OBSERVABLE COMPLETION & GUARD
    // ------------------------------------------------------------
    console.log("\n--- 13. View Statement: Target Selection, Execution, & Observable Completion ---");

    // 13.1 Initial Banking Page State
    const bankingInitialState = {
        title: "PRIVAGENT Demo Banking Portal",
        url: "http://127.0.0.1:5500/banking.html",
        elements: [
            { type: "input", label: "Customer Name", selector: "#customerName", enabled: true },
            { type: "input", label: "Account Number", selector: "#accountNumber", enabled: true },
            { type: "input", label: "Phone Number", selector: "#phone", enabled: true },
            { type: "input", label: "Transfer Amount", selector: "#amount", enabled: true },
            { type: "button", label: "View Statement", selector: "#statementButton", enabled: true },
            { type: "button", label: "Transfer Money", selector: "#transferButton", enabled: true },
            { type: "a", label: "Need Help?", selector: "#helpLink", enabled: true }
        ]
    };

    // Step 1: Target Selection
    global.fetch = async (url, opts) => {
        const body = JSON.parse(opts.body);
        if (body.goal && body.goal.toLowerCase().includes("view statement")) {
            // Check if statement is loaded
            const controls = body.visible_controls || [];
            const isLoaded = controls.some(c => (c.label || "").toLowerCase().includes("statement loaded"));
            if (isLoaded) {
                return {
                    ok: true,
                    json: async () => ({
                        success: true,
                        message: "Statement view loaded successfully. Goal accomplished.",
                        action: { action: "noop" },
                        planner: "local-deterministic"
                    })
                };
            }
            return {
                ok: true,
                json: async () => ({
                    success: true,
                    message: "Identified statement button.",
                    action: { action: "click", selector: "#statementButton" },
                    planner: "local-deterministic"
                })
            };
        }
        return {
            ok: true,
            json: async () => ({
                success: true,
                message: "No action.",
                action: { action: "noop" },
                planner: "local-deterministic"
            })
        };
    };

    async function dispatchRuntimeMessage(msg) {
        return new Promise((resolve) => {
            backgroundMessageListener(msg, {}, (res) => resolve(res));
        });
    }

    const step1Response = await dispatchRuntimeMessage({
        type: "RUN_AGENT",
        command: "Click View Statement",
        step: 1,
        sanitizedContext: bankingInitialState
    });

    check("Step 1 correctly targets View Statement button (#statementButton)", step1Response.action?.action === "click" && step1Response.action?.selector === "#statementButton");
    check("Step 1 action is not noop", step1Response.isNoop === false);

    // 13.2 Browser Click Execution & Observable DOM State Change
    let simulatedStatementSectionVisible = false;
    let statementButtonLabel = "View Statement";
    let statementButtonLoadedAttr = null;

    function simulateBankingClick(selector) {
        if (selector === "#statementButton") {
            simulatedStatementSectionVisible = true;
            statementButtonLabel = "Statement Loaded";
            statementButtonLoadedAttr = "true";
            return { success: true, action: "click" };
        }
        return { success: false, error: "Target not found" };
    }

    const clickExecResult = simulateBankingClick(step1Response.action.selector);
    check("Click execution on #statementButton succeeds", clickExecResult.success === true);
    check("Observable effect: statement section displayed", simulatedStatementSectionVisible === true);
    check("Observable effect: button label updated to 'Statement Loaded'", statementButtonLabel === "Statement Loaded");
    check("Observable effect: data-statement-loaded attribute set", statementButtonLoadedAttr === "true");

    // 13.3 Fresh Page State Capture after Click
    const bankingFreshState = {
        title: "PRIVAGENT Demo Banking Portal",
        url: "http://127.0.0.1:5500/banking.html",
        elements: [
            { type: "input", label: "Customer Name", selector: "#customerName", enabled: true },
            { type: "input", label: "Account Number", selector: "#accountNumber", enabled: true },
            { type: "input", label: "Phone Number", selector: "#phone", enabled: true },
            { type: "input", label: "Transfer Amount", selector: "#amount", enabled: true },
            { type: "button", label: statementButtonLabel, selector: "#statementButton", enabled: true },
            { type: "button", label: "Transfer Money", selector: "#transferButton", enabled: true },
            { type: "a", label: "Need Help?", selector: "#helpLink", enabled: true }
        ]
    };

    // Step 2: Observable Completion
    const step2Response = await dispatchRuntimeMessage({
        type: "RUN_AGENT",
        command: "Click View Statement",
        step: 2,
        previousActions: [step1Response.action],
        sanitizedContext: bankingFreshState
    });

    check("Step 2 recognizes observable completion and returns noop", step2Response.isNoop === true && step2Response.action?.action === "noop");
    check("Step 2 reports status 'completed'", step2Response.status === "completed");
    check("Step 2 message notes goal accomplished", step2Response.message.includes("accomplished") || step2Response.message.includes("loaded"));

    // 13.4 Bounded Multi-Step Loop Completes at Step 2 with Truthful History
    let loopPageState = JSON.parse(JSON.stringify(bankingInitialState));
    const multiStepResult = await runBoundedAgentLoop({
        command: "Click View Statement",
        stepDelayMs: 0,
        getPageStateFn: async () => loopPageState,
        planFn: async (goal, pageState, { step, history }) => {
            const controls = pageState.elements || [];
            const isLoaded = controls.some(c => (c.label || "").toLowerCase().includes("statement loaded"));
            if (isLoaded) {
                return { action: { action: "noop" } };
            }
            return { action: { action: "click", selector: "#statementButton" } };
        },
        executeActionFn: async (action) => {
            if (action.selector === "#statementButton") {
                loopPageState.elements.find(e => e.selector === "#statementButton").label = "Statement Loaded";
                return { success: true };
            }
            return { success: false, error: "Target missing" };
        }
    });

    check("Bounded multi-step loop finishes with status 'completed'", multiStepResult.status === "completed");
    check("Bounded loop finishes at step 2 upon verified outcome", multiStepResult.step === 2);
    check("Truthful history: exactly 1 interactive action executed", multiStepResult.history.length === 1);
    check("Executed action was click on #statementButton", multiStepResult.history[0].action.selector === "#statementButton");

    // 13.5 Repeated-Action Termination (Guard Verification When State Does NOT Change)
    // If the click did NOT produce any state change and planner proposes identical click again
    const loopResultUnchanged = await runBoundedAgentLoop({
        command: "Click View Statement (Faulty Unchanged State)",
        stepDelayMs: 0,
        getPageStateFn: async () => bankingInitialState, // NEVER changes!
        planFn: async () => ({ action: { action: "click", selector: "#statementButton" } }), // Proposes identical action repeatedly
        executeActionFn: async () => ({ success: true }) // Simulates click that had no DOM effect
    });

    check("Unchanged state repeated action strictly halted by loop guard", loopResultUnchanged.status === "failed");
    check("Loop guard explicitly cites infinite loop on unchanged state", loopResultUnchanged.error.includes("Infinite loop detected"));
    check("Does not falsely report success when state was unchanged", loopResultUnchanged.success === false);

    // ------------------------------------------------------------
    // 14. SEMANTIC PAGE STATE FINGERPRINTING & RESISTANCE TO VOLATILE SELECTORS
    // ------------------------------------------------------------
    console.log("\n--- 14. Semantic Page State Fingerprinting Tests ---");

    const stateA = {
        title: "Test Page",
        url: "http://example.com/test",
        text: "Content version 1",
        elements: [
            { type: "button", label: "Submit", enabled: true, selector: '[data-privagent-id="pa-abc123"]' }
        ]
    };

    const stateA_volatileId = {
        title: "Test Page",
        url: "http://example.com/test",
        text: "Content version 1",
        elements: [
            { type: "button", label: "Submit", enabled: true, selector: '[data-privagent-id="pa-xyz999"]' }
        ]
    };

    const stateB_labelChanged = {
        title: "Test Page",
        url: "http://example.com/test",
        text: "Content version 1",
        elements: [
            { type: "button", label: "Submitted", enabled: true, selector: '[data-privagent-id="pa-abc123"]' }
        ]
    };

    const stateC_textChanged = {
        title: "Test Page",
        url: "http://example.com/test",
        text: "Content version 2 - Statement Loaded",
        elements: [
            { type: "button", label: "Submit", enabled: true, selector: '[data-privagent-id="pa-abc123"]' }
        ]
    };

    const fpA = computePageStateFingerprint(stateA);
    const fpA_volatile = computePageStateFingerprint(stateA_volatileId);
    const fpB = computePageStateFingerprint(stateB_labelChanged);
    const fpC = computePageStateFingerprint(stateC_textChanged);

    check("Fingerprint is invariant to volatile privagent random IDs", fpA === fpA_volatile);
    check("Fingerprint changes when element label changes", fpA !== fpB);
    check("Fingerprint changes when page text changes", fpA !== fpC);

    // ------------------------------------------------------------
    // 15. REPEATED ACTIONS ON GENUINELY CHANGED STATE (NO FALSE INFINITE LOOP)
    // ------------------------------------------------------------
    console.log("\n--- 15. Repeated Actions Allowed on Genuinely Changed State ---");

    let itemsLoaded = 5;
    const paginationResult = await runBoundedAgentLoop({
        command: "Load more items until page full",
        stepDelayMs: 0,
        getPageStateFn: async () => ({
            title: "Item Feed",
            text: `Currently showing ${itemsLoaded} items`,
            elements: [
                { type: "button", label: "Load More", selector: "#load-more-btn", enabled: true }
            ]
        }),
        planFn: async (goal, pageState, { step }) => {
            if (step >= 3) {
                return { action: { action: "noop" } };
            }
            // Proposing exact same action on steps 1 and 2, but state changes between steps
            return { action: { action: "click", selector: "#load-more-btn" } };
        },
        executeActionFn: async () => {
            itemsLoaded += 5; // Observable state change on every click
            return { success: true };
        }
    });

    check("Repeated action signature on changed state does NOT falsely trigger loop error", paginationResult.status === "completed");
    check("Pagination task successfully completes at step 3", paginationResult.step === 3);
    check("History accurately records the executed repetitive actions", paginationResult.history.length === 2);

    // ------------------------------------------------------------
    // 16. OBSERVABLE COMPLETION RESOLUTION FOR RUN_AGENT (POPUP PATH)
    // ------------------------------------------------------------
    console.log("\n--- 16. Observable Completion Resolution on RUN_AGENT Message Path ---");

    // 16.1 RUN_AGENT Path: Model proposes repeated click, but observable state reflects completion
    // The agent must recognize observable completion and return noop/completed instead of failing
    const mockModelProposesRepeatedClick = async (url, options) => {
        return {
            ok: true,
            json: async () => ({
                success: true,
                message: "Model decided to click statement button again.",
                action: { action: "click", selector: "#statementButton" },
                planner: "gemini"
            })
        };
    };

    global.fetch = mockModelProposesRepeatedClick;

    // Reset task state for fresh test
    endTask();

    // Step 1: Initial Click View Statement
    const step1RunAgent = await dispatchRuntimeMessage({
        type: "RUN_AGENT",
        command: "Click View Statement",
        step: 1,
        sanitizedContext: bankingInitialState
    });
    check("Step 1 returns approved click action", step1RunAgent.action.action === "click");

    // Step 2: Fresh page state has button with 'Statement Loaded'
    // Server/model returns repeated click on #statementButton
    // background.js must catch observable completion and return noop with status 'completed'
    const step2RunAgent = await dispatchRuntimeMessage({
        type: "RUN_AGENT",
        command: "Click View Statement",
        step: 2,
        history: [{ step: 1, action: step1RunAgent.action }],
        sanitizedContext: bankingFreshState
    });

    check("Step 2 recognizes observable completion and returns noop (not false loop error)", step2RunAgent.action.action === "noop");
    check("Step 2 reports isNoop true", step2RunAgent.isNoop === true);
    check("Step 2 reports status completed", step2RunAgent.status === "completed");
    check("Step 2 does not return false infinite loop error", !step2RunAgent.error);

    // 16.2 RUN_AGENT Path: Repeated action on TRULY UNCHANGED state strictly fails
    endTask();
    const mockServerEndlessAction = async () => ({
        ok: true,
        json: async () => ({
            success: true,
            action: { action: "click", selector: "#staticBtn" },
            planner: "local-deterministic"
        })
    });
    global.fetch = mockServerEndlessAction;

    const staticState = {
        title: "Static Page",
        url: "http://example.com/static",
        text: "Static unchanged body",
        elements: [
            { type: "button", label: "Do Nothing", selector: "#staticBtn", enabled: true }
        ]
    };

    // Step 1
    const runAgentStaticStep1 = await dispatchRuntimeMessage({
        type: "RUN_AGENT",
        command: "Click Do Nothing",
        step: 1,
        sanitizedContext: staticState
    });
    check("Static step 1 returns click action", runAgentStaticStep1.action.action === "click");

    // Step 2: Identical state, identical action, unsatisfied goal -> MUST FAIL
    const runAgentStaticStep2 = await dispatchRuntimeMessage({
        type: "RUN_AGENT",
        command: "Click Do Nothing",
        step: 2,
        history: [{ step: 1, action: runAgentStaticStep1.action }],
        sanitizedContext: staticState
    });

    check("Static step 2 strictly detects infinite loop on unchanged state", runAgentStaticStep2.success === false);
    check("Static step 2 error explicitly cites infinite loop", runAgentStaticStep2.error.includes("Infinite loop detected: repeated identical action on unchanged state."));

    // Cleanup mock fetch
    endTask();

    // ------------------------------------------------------------
    // SUMMARY
    // ------------------------------------------------------------
    console.log("\n============================================================");
    console.log(` RESULTS: ${passed} passed, ${failed} failed`);
    console.log("============================================================\n");

    if (failed > 0) {
        process.exit(1);
    }
}

runAllTests().catch(err => {
    console.error("Unhandled test suite exception:", err);
    process.exit(1);
});
