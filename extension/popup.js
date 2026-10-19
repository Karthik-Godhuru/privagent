const commandInput = typeof document !== "undefined" ? document.getElementById("command") : null;
const runButton = typeof document !== "undefined" ? document.getElementById("runButton") : null;
const analyzeButton = typeof document !== "undefined" ? document.getElementById("analyzeButton") : null;
const statusElement = typeof document !== "undefined" ? document.getElementById("status") : null;
const resultElement = typeof document !== "undefined" ? document.getElementById("result") : null;

const MAX_STEPS = 6;
const STEP_DELAY_MS = 600;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/* --------------------------------
   GET ACTIVE TAB
-------------------------------- */

async function getActiveTab() {
  const tabs = await chrome.tabs.query({
    active: true,
    currentWindow: true
  });

  if (!tabs || tabs.length === 0) {
    throw new Error("No active tab found.");
  }

  if (!tabs[0].id) {
    throw new Error("Active tab ID unavailable.");
  }

  return tabs[0];
}

/* --------------------------------
   GET SANITIZED PAGE STATE
-------------------------------- */

async function getPageState(tabId) {
  try {
    const response = await chrome.tabs.sendMessage(
      tabId,
      {
        type: "GET_PAGE_STATE"
      }
    );

    if (!response || !response.success) {
      throw new Error(
        response?.error || "Unable to get page state."
      );
    }

    return response.pageState;
  } catch (error) {
    console.error("Page state error:", error);
    throw new Error(
      "Privacy/content script is not available on this page."
    );
  }
}

/* --------------------------------
   ANALYZE PAGE
-------------------------------- */

if (analyzeButton) {
  analyzeButton.addEventListener("click", async () => {
    if (statusElement) statusElement.textContent = "Analyzing page...";
    if (resultElement) resultElement.textContent = "";

    try {
      const tab = await getActiveTab();
      const pageState = await getPageState(tab.id);

      if (resultElement) {
        resultElement.textContent = JSON.stringify(pageState, null, 2);
      }
      if (statusElement) {
        statusElement.textContent = "Page analyzed successfully.";
      }
    } catch (error) {
      console.error(error);
      if (statusElement) statusElement.textContent = "Analysis failed.";
      if (resultElement) resultElement.textContent = error.message;
    }
  });
}

/* --------------------------------
   RUN AGENT (Bounded Multi-Step Loop using existing RUN_AGENT schema)
-------------------------------- */

if (runButton) {
  runButton.addEventListener("click", async () => {
    const command = commandInput ? commandInput.value.trim() : "";

    if (!command) {
      if (statusElement) statusElement.textContent = "Enter a command first.";
      return;
    }

    // Disable action buttons to prevent concurrent task runs
    runButton.disabled = true;
    if (analyzeButton) analyzeButton.disabled = true;

    if (statusElement) statusElement.textContent = "Running agent...";
    if (resultElement) resultElement.textContent = "";

    try {
      const tab = await getActiveTab();
      const history = [];

      for (let step = 1; step <= MAX_STEPS; step++) {
        // Step 1: Capture fresh sanitized page state
        if (statusElement) {
          statusElement.textContent = `Step ${step}/${MAX_STEPS}: Capturing sanitized page state...`;
        }

        const pageState = await getPageState(tab.id);

        // Step 2: Request agent reasoning via existing RUN_AGENT message schema
        if (statusElement) {
          statusElement.textContent = `Step ${step}/${MAX_STEPS}: Planning next action...`;
        }

        const response = await chrome.runtime.sendMessage({
          type: "RUN_AGENT",
          command: command,
          step: step,
          previousActions: history.map(h => h.action),
          history: history,
          sanitizedContext: pageState
        });

        if (!response || !response.success) {
          const failErr = response?.error || "Agent step validation failed.";
          if (statusElement) {
            statusElement.textContent = `Step ${step}/${MAX_STEPS}: Failed - ${failErr}`;
          }
          if (resultElement) {
            resultElement.textContent = JSON.stringify({
              status: response?.status || "failed",
              step: step,
              error: failErr,
              history: history
            }, null, 2);
          }
          return;
        }

        // Step 3: Check for goal completion (noop)
        if (response.isNoop || response.action?.action === "noop" || response.status === "completed") {
          if (statusElement) {
            statusElement.textContent = `Goal completed at step ${step}.`;
          }
          if (resultElement) {
            resultElement.textContent = JSON.stringify({
              status: "completed",
              step: step,
              planner: response.planner || "local-deterministic",
              message: response.message || "Goal accomplished.",
              action: response.action,
              history: history
            }, null, 2);
          }
          return;
        }

        const action = response.action;

        // Step 4: Security Confirmation Gate for consequential actions
        if (
          response.requiresConfirmation ||
          action.requires_confirmation ||
          action.action === "navigate"
        ) {
          if (statusElement) {
            statusElement.textContent = `Step ${step}/${MAX_STEPS}: Awaiting user authorization...`;
          }

          const actionDetails =
            action.action === "navigate"
              ? `Navigate to: ${action.url}`
              : action.action === "type"
              ? `Type into field (${action.selector || "input"})`
              : `${action.action.toUpperCase()} on ${action.selector || "target"}`;

          const userApproved = confirm(
            `PrivAgent Security Gate (Step ${step}/${MAX_STEPS})\n\nAction: ${actionDetails}\n\nDo you authorize this browser action?`
          );

          if (!userApproved) {
            if (statusElement) {
              statusElement.textContent = "Action cancelled by user.";
            }
            if (resultElement) {
              resultElement.textContent = JSON.stringify({
                status: "blocked",
                reason: "Action rejected by user confirmation gate.",
                step: step,
                action: action,
                history: history
              }, null, 2);
            }
            return;
          }
        }

        // Step 5: Execute action locally in browser via existing EXECUTE_ACTION schema
        if (statusElement) {
          statusElement.textContent = `Step ${step}/${MAX_STEPS}: Executing ${action.action}...`;
        }

        const execution = await chrome.runtime.sendMessage({
          type: "EXECUTE_ACTION",
          tabId: tab.id,
          action: action
        });

        if (!execution || !execution.success) {
          const execErr = execution?.error || "Browser action execution failed.";
          if (statusElement) {
            statusElement.textContent = `Step ${step}/${MAX_STEPS}: Execution error - ${execErr}`;
          }
          if (resultElement) {
            resultElement.textContent = JSON.stringify({
              status: "failed",
              step: step,
              action: action,
              error: execErr,
              history: history
            }, null, 2);
          }
          return;
        }

        history.push({
          step: step,
          action: action,
          planner: response.planner,
          result: execution
        });

        // Step 6: Wait for page to settle before next step
        if (step < MAX_STEPS) {
          if (statusElement) {
            statusElement.textContent = `Step ${step}/${MAX_STEPS}: Settling (${STEP_DELAY_MS}ms)...`;
          }
          await sleep(STEP_DELAY_MS);
        }
      }

      // Max steps reached without noop
      if (statusElement) {
        statusElement.textContent = `Task stopped: maximum step limit (${MAX_STEPS}) reached.`;
      }
      if (resultElement) {
        resultElement.textContent = JSON.stringify({
          status: "partially_completed",
          message: `Maximum step limit (${MAX_STEPS}) reached before goal completion.`,
          step: MAX_STEPS,
          history: history
        }, null, 2);
      }

    } catch (error) {
      console.error("PrivAgent loop error:", error);
      if (statusElement) statusElement.textContent = "Agent failed.";
      if (resultElement) resultElement.textContent = error.message;
    } finally {
      if (runButton) runButton.disabled = false;
      if (analyzeButton) analyzeButton.disabled = false;
    }
  });
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    MAX_STEPS,
    STEP_DELAY_MS,
    getActiveTab,
    getPageState,
    sleep
  };
}
