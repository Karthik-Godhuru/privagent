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
        "Page analyzed successfully.";

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


        if (execution?.success) {

          statusElement.textContent =
            "Action completed.";

        } else {

          statusElement.textContent =
            "Action execution failed.";
        }

      } else {

        statusElement.textContent =
          "Agent completed.";
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
    statusElement.textContent = "Capturing screenshot...";

    try {
        console.log("Sending screenshot request to background");
        const response = await chrome.runtime.sendMessage({
            type: "CAPTURE_SCREENSHOT"
        });

        if (!response || !response.success || !response.dataUrl) {
            throw new Error(response?.error || "Screenshot capture failed.");
        }

        screenshotPreview.src = response.dataUrl;
        screenshotPreview.style.display = "block";
        resultElement.textContent = "Screenshot captured locally.";
        statusElement.textContent = "Screenshot ready.";
    } catch (error) {
        statusElement.textContent = "Screenshot capture failed.";
        resultElement.textContent = error.message;
    } finally {
        captureButton.disabled = false;
    }
});
