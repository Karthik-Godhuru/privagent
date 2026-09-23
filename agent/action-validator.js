const { isValidAction } = require("./action-schema");

function validateAction(action, pageState) {

    if (!isValidAction(action)) {
        return {
            allowed: false,
            reason: "Invalid action format"
        };
    }

    if (
        action.action === "wait" ||
        action.action === "noop"
    ) {
        return {
            allowed: true,
            reason: "Valid non-browser-target action"
        };
    }

    if (action.action === "navigate") {
        return {
            allowed: true,
            reason: "Valid navigation action"
        };
    }

    const elementExists =
        pageState?.elements?.some(
            element =>
                element.selector === action.selector
        );

    if (!elementExists) {
        return {
            allowed: false,
            reason: "Target selector does not exist on the page"
        };
    }

    return {
        allowed: true,
        reason: "Action approved"
    };
}

module.exports = {
    validateAction
};
