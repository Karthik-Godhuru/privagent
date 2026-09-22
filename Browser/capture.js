function capturePageState() {
    return {
        title: document.title,
        url: window.location.href,
        text: document.body?.innerText || "",
        elements: []
    };
}

module.exports = {
    capturePageState
};
