function executeAction(action, element) {
    if (!action || !element) {
        throw new Error("Invalid action or target");
    }

    switch (action.action) {
        case "click":
            element.click();
            return { success: true };

        case "type":
            element.focus();
            element.value = action.value || "";
            element.dispatchEvent(new Event("input", { bubbles: true }));
            return { success: true };

        case "select":
            element.value = action.value;
            element.dispatchEvent(new Event("change", { bubbles: true }));
            return { success: true };

        default:
            return {
                success: false,
                reason: "Unsupported browser action"
            };
    }
}

module.exports = {
    executeAction
};
