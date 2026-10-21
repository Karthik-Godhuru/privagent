const commandInput = document.getElementById("command");
const runButton = document.getElementById("runButton");
const analyzeButton = document.getElementById("analyzeButton");
const statusElement = document.getElementById("status");
const resultElement = document.getElementById("result");


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

    // First, try the content script normally
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

    console.log(
      "Content script not connected. Injecting it now..."
    );

    // Inject privacy gate first
    await chrome.scripting.executeScript({
      target: {
        tabId: tabId
      },
      files: ["privacy-gate.js"]
    });

    // Then inject content script
    await chrome.scripting.executeScript({
      target: {
        tabId: tabId
      },
      files: ["content.js"]
    });

    // Try communicating again
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
  }
}


/* --------------------------------
   ANALYZE PAGE
-------------------------------- */

analyzeButton.addEventListener(
  "click",
  async () => {

    const command =
      commandInput.value.trim() || "Analyze page";

    statusElement.textContent =
      "Analyzing page...";

    resultElement.textContent = "";

    try {

      const tab = await getActiveTab();

      const pageState =
        await getPageState(tab.id);

      resultElement.textContent =
        JSON.stringify(
          pageState,
          null,
          2
        );

      statusElement.textContent =
        "Requesting AI agent analysis...";

      try {

        const response =
          await chrome.runtime.sendMessage({

            type: "RUN_AGENT",

            command: command,

            sanitizedContext: pageState
          });

        if (!response) {
          throw new Error(
            "No response from background service."
          );
        }

        if (!response.success) {
          throw new Error(
            response.error ||
            "Agent analysis failed."
          );
        }

        resultElement.textContent =
          JSON.stringify(
            {
              agentResponse: response,
              sanitizedPageState: pageState
            },
            null,
            2
          );

        statusElement.textContent =
          "Page analyzed and agent plan received.";

      } catch (agentError) {

        console.error(
          "AI agent analysis error:",
          agentError
        );

        resultElement.textContent =
          JSON.stringify(
            {
              agentError: agentError.message,
              sanitizedPageState: pageState
            },
            null,
            2
          );

        statusElement.textContent =
          "Page analyzed locally (AI agent unavailable).";
      }

    } catch (error) {

      console.error(error);

      statusElement.textContent =
        "Analysis failed.";

      resultElement.textContent =
        error.message;
    }
  }
);


/* --------------------------------
   RUN AGENT
-------------------------------- */

runButton.addEventListener(
  "click",
  async () => {

    const command =
      commandInput.value.trim();

    if (!command) {

      statusElement.textContent =
        "Enter a command first.";

      return;
    }

    statusElement.textContent =
      "Running agent...";

    resultElement.textContent = "";

    try {

      const tab =
        await getActiveTab();


      /* Get privacy-sanitized page */

      const pageState =
        await getPageState(tab.id);


      /* Send to background service worker */

      const response =
        await chrome.runtime.sendMessage({

          type: "RUN_AGENT",

          command: command,

          sanitizedContext: pageState
        });


      if (!response) {

        throw new Error(
          "No response from background service."
        );
      }


      if (!response.success) {

        throw new Error(
          response.error ||
          "Agent execution failed."
        );
      }


      resultElement.textContent =
        JSON.stringify(
          response,
          null,
          2
        );


      /* --------------------------------
         EXECUTE APPROVED ACTION
      -------------------------------- */

      if (response.action) {

        statusElement.textContent =
          "Executing action...";


        const execution =
          await chrome.runtime.sendMessage({

            type: "EXECUTE_ACTION",

            tabId: tab.id,

            action: response.action
          });


        resultElement.textContent =
          JSON.stringify(
            {
              agentResponse: response,
              execution: execution
            },
            null,
            2
          );


        if (!execution) {
          throw new Error(
            "No response from action executor."
          );
        }


        if (execution.success && execution.verification && !execution.verified) {

          statusElement.textContent =
            `Action sent; result unverified: ${execution.verification.detail || "The page did not expose a confirmation."}`;

        } else if (execution.success && (execution.verified || !execution.verification)) {

          const actionType =
            execution.action ||
            response.action?.action;

          if (actionType === "noop") {

            if (response.ambiguous) {
              statusElement.textContent =
                "Ambiguous target: multiple matching elements found.";
            } else if (response.notFound) {
              statusElement.textContent =
                response.message || "Could not find a matching Add to Cart button.";
            } else if (response.message) {
              statusElement.textContent =
                response.message;
            } else {
              statusElement.textContent =
                "No action needed.";
            }

          } else if (actionType === "wait") {

            statusElement.textContent =
              "Wait completed.";

          } else if (execution.verified) {

            statusElement.textContent =
              `Action verified: ${execution.verification?.detail || "Product confirmed in cart."}`;

          } else {

            statusElement.textContent =
              "Action completed.";
          }

        } else {

          const failureDetail =
            execution?.error ||
            execution?.verification?.detail ||
            "Product was not confirmed in the cart.";

          statusElement.textContent =
            `Action failed: ${failureDetail}`;
        }

      } else {

        statusElement.textContent =
          "Agent completed (no action returned).";
      }


    } catch (error) {

      console.error(
        "PRIVAGENT error:",
        error
      );

      statusElement.textContent =
        "Agent failed.";

      resultElement.textContent =
        error.message;
    }
  }
);


const captureButton = document.getElementById("captureButton");
const screenshotPreview = document.getElementById("screenshotPreview");

captureButton.addEventListener("click", async () => {
    console.log("Capture Screenshot button clicked");
    captureButton.disabled = true;
    screenshotPreview.style.display = "none";
    screenshotPreview.removeAttribute("src");

    statusElement.textContent = "Capturing screenshot...";

    try {
        console.log("Sending screenshot request to background");
        const response = await chrome.runtime.sendMessage({
            type: "CAPTURE_SCREENSHOT"
        });

        if (!response || !response.success || !response.dataUrl) {
            throw new Error(response?.error || "Screenshot capture failed.");
    }
const redacted = await redactScreenshotDataUrl(response.dataUrl);
screenshotPreview.src = redacted.dataUrl;
screenshotPreview.style.display = "block";
resultElement.textContent =
    `Screenshot processed locally. Redacted lines: ${redacted.redactedLines}`;
statusElement.textContent = "Redacted screenshot ready.";

    } catch (error) {
        screenshotPreview.style.display = "none";
        screenshotPreview.removeAttribute("src");
        statusElement.textContent = "Screenshot capture failed.";
        resultElement.textContent = error.message;
    } finally {
        captureButton.disabled = false;
    }
});
