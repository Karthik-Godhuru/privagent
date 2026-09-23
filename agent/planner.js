async function createPlan(userCommand, pageState, taskState = {}) {

    const response = await fetch(
        "http://127.0.0.1:8000/agent",
        {
            method: "POST",

            headers: {
                "Content-Type": "application/json"
            },

            body: JSON.stringify({
                command: userCommand,

                sanitized_context: pageState,

                task_state: taskState
            })
        }
    );

    if (!response.ok) {

        throw new Error(
            `Agent server error: ${response.status}`
        );
    }

    const result = await response.json();

    /*
     * The server returns an agent response.
     * Extract the proposed action.
     */

    if (!result.action) {

        throw new Error(
            "Agent server did not return an action."
        );
    }

    return result.action;
}


module.exports = {
    createPlan
};
