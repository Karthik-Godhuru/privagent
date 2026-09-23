const { createPlan } = require("./planner");
const { validateAction } = require("./action-validator");


async function runAgent(
    userCommand,
    pageState,
    taskState = {}
) {

    console.log(
        "User command:",
        userCommand
    );

    console.log(
        "Current page state:",
        pageState
    );


    // 1. Ask planner for next action

    const action = await createPlan(
        userCommand,
        pageState,
        taskState
    );


    console.log(
        "Proposed action:",
        action
    );


    // 2. Validate action

    const validation =
        validateAction(
            action,
            pageState
        );


    console.log(
        "Validation:",
        validation
    );


    // 3. Block unsafe action

    if (!validation.allowed) {

        return {
            success: false,

            action: action,

            reason: validation.reason
        };
    }


    // 4. Return approved action

    return {
        success: true,

        action: action,

        reason: validation.reason
    };
}


module.exports = {
    runAgent
};
