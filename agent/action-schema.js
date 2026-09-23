const ALLOWED_ACTIONS = [
    "click",
    "type",
    "scroll",
    "navigate",
    "wait",
    "noop"
];

function isValidAction(action) {

    if (!action || typeof action !== "object") {
        return false;
    }

    if (!ALLOWED_ACTIONS.includes(action.action)) {
        return false;
    }

    // wait and noop don't need a target
    if (
        action.action !== "wait" &&
        action.action !== "noop"
    ) {
        if (action.action === "navigate") {
            return typeof action.url === "string" && action.url.length > 0;
        }

        if (!action.selector) {
            return false;
        }
    }

    return true;
}

module.exports = {
    ALLOWED_ACTIONS,
    isValidAction
};
