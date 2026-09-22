function createTaskState(userCommand) {
    return {
        goal: userCommand,
        status: "running",
        step: 0,
        history: [],
        lastAction: null,
        lastResult: null
    };
}

function updateTaskState(state, action, result) {
    return {
        ...state,
        step: state.step + 1,
        lastAction: action,
        lastResult: result,
        history: [
            ...state.history,
            {
                step: state.step + 1,
                action,
                result
            }
        ]
    };
}

function completeTask(state) {
    return {
        ...state,
        status: "completed"
    };
}

function failTask(state, reason) {
    return {
        ...state,
        status: "failed",
        lastResult: reason
    };
}

module.exports = {
    createTaskState,
    updateTaskState,
    completeTask,
    failTask
};
