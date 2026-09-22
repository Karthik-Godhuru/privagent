const ALLOWED_ACTIONS = [
    "click",
    "type",
    "scroll",
    "navigate",
    "select",
    "wait"
];

function isValidAction(action) {
    if (!action || typeof action !== "object") {
        return false;
    }

    if (!ALLOWED_ACTIONS.includes(action.action)) {
        return false;
    }

    if (action.action !== "wait" && !action.target) {
        return false;
    }

    return true;
}

module.exports = {
    ALLOWED_ACTIONS,
    isValidAction
};
