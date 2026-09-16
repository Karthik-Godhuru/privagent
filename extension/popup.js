document
  .getElementById("analyzeButton")
  .addEventListener("click", async () => {
    const statusElement = document.getElementById("status");
    const resultElement = document.getElementById("result");

    statusElement.textContent = "Analyzing page...";
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
        throw new Error("Active tab ID is unavailable.");
      }

      const response = await chrome.tabs.sendMessage(
        activeTab.id,
        {
          type: "EXTRACT_PAGE"
        }
      );

      if (!response) {
        throw new Error("No response received from the webpage.");
      }

      displayAnalysisResult(response);

      statusElement.textContent = "Analysis completed successfully.";
    } catch (error) {
      console.error("PRIVAGENT analysis error:", error);

      statusElement.textContent = "Analysis failed.";

      resultElement.textContent =
        "Unable to analyze this page.\n\n" +
        "Possible reasons:\n" +
        "1. The content script is not loaded yet.\n" +
        "2. The current page is a restricted Chrome page.\n" +
        "3. The extension needs to be reloaded.\n\n" +
        "Error: " +
        error.message;
    }
  });

function displayAnalysisResult(data) {
  const resultElement = document.getElementById("result");

  const sensitiveFindings = Array.isArray(data.sensitiveFindings)
    ? data.sensitiveFindings
    : [];

  const result = {
    pageTitle: data.pageTitle || "",
    url: data.url || "",
    buttons: data.buttons || [],
    inputs: data.inputs || [],
    links: data.links || [],
    visibleText: data.visibleText || "",
    sensitiveDataCount:
      data.sensitiveDataCount !== undefined
        ? data.sensitiveDataCount
        : sensitiveFindings.length,
    sensitiveFindings: sensitiveFindings
  };

  resultElement.textContent = JSON.stringify(result, null, 2);
}
