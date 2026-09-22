const { createPlan } = require("./planner");
const { validateAction } = require("./action-validator");

function runAgent(userCommand, pageState) {

    console.log("User command:", userCommand);

    console.log("Current page state:", pageState);

    // 1. Ask planner for next action
    const action = createPlan(userCommand, pageState);

    console.log("Proposed action:", action);

    // 2. Validate action
    const validation = validateAction(action, pageState);

    console.log("Validation:", validation);

    // 3. Block unsafe action
    if (!validation.allowed) {
        return {
            success: false,
            action,
            reason: validation.reason
        };
    }

    // 4. Return approved action
    return {
        success: true,
        action,
        reason: validation.reason
    };
}

module.exports = {
    runAgent
};
