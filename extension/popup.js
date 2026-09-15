const analyzeButton = document.getElementById("analyzeButton");
const statusText = document.getElementById("status");
const resultBox = document.getElementById("result");

analyzeButton.addEventListener("click", async () => {
  statusText.textContent = "Analyzing page...";
  resultBox.textContent = "";

  try {
    const tabs = await chrome.tabs.query({
      active: true,
      currentWindow: true
    });

    const activeTab = tabs[0];

    if (!activeTab || !activeTab.id) {
      throw new Error("No active tab found.");
    }

    const response = await chrome.tabs.sendMessage(activeTab.id, {
      type: "EXTRACT_PAGE"
    });

    resultBox.textContent = JSON.stringify(response, null, 2);
    statusText.textContent = "Analysis complete";
  } catch (error) {
    statusText.textContent = "Error";
    resultBox.textContent =
      "Unable to analyze this page.\n\n" + error.message;
  }
});
