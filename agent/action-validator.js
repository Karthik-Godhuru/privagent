const { isValidAction } = require("./action-schema");

function validateAction(action, pageState) {
    if (!isValidAction(action)) {
        return {
            allowed: false,
            reason: "Invalid action format"
        };
    }

    if (action.action === "wait") {
        return {
            allowed: true,
            reason: "Valid wait action"
        };
    }

    const elementExists = pageState.elements?.some(
        element => element.id === action.target
    );

    if (!elementExists) {
        return {
            allowed: false,
            reason: "Target element does not exist"
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
