document
  .getElementById("analyzeButton")
  .addEventListener("click", async () => {

    const statusElement =
      document.getElementById("status");

    const resultElement =
      document.getElementById("result");

    statusElement.textContent =
      "Analyzing page...";

    resultElement.textContent = "";

    try {

      const tabs = await chrome.tabs.query({
        active: true,
        currentWindow: true
      });

      if (!tabs || tabs.length === 0) {
        throw new Error("No active tab found.");
      }

      const activeTab = tabs[0];

      if (!activeTab.id) {
        throw new Error(
          "Active tab ID is unavailable."
        );
      }

      let response;

      // First, try to communicate with content.js
      try {

        response = await chrome.tabs.sendMessage(
          activeTab.id,
          {
            type: "EXTRACT_PAGE"
          }
        );

      } catch (connectionError) {

        // content.js is not loaded.
        // Load it into the current page.

        console.log(
          "Content script not connected. Injecting content.js..."
        );

        await chrome.scripting.executeScript({
          target: {
            tabId: activeTab.id
          },
          files: [
            "content.js"
          ]
        });

        // Try again after injection
        response = await chrome.tabs.sendMessage(
          activeTab.id,
          {
            type: "EXTRACT_PAGE"
          }
        );
      }

      if (!response) {
        throw new Error(
          "No response received from webpage."
        );
      }

      resultElement.textContent =
        JSON.stringify(
          response,
          null,
          2
        );

      statusElement.textContent =
        "Analysis completed successfully.";

    } catch (error) {

      console.error(
        "PrivAgent error:",
        error
      );

      statusElement.textContent =
        "Analysis failed.";

      resultElement.textContent =
        "Error:\n\n" +
        error.message;
    }
  });