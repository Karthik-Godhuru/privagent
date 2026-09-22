chrome.runtime.onInstalled.addListener(() => {
    console.log("PrivAgent installed successfully.");
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log("PrivAgent message:", message);

    if (message.type === "PING") {
        sendResponse({
            success: true,
            message: "PrivAgent is running"
        });
    }

    return true;
});
