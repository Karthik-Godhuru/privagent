async function createPlan(userCommand, pageState, taskState) {

    const response = await fetch("http://localhost:8000/plan", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            command: userCommand,
            page_state: pageState,
            task_state: taskState
        })
    });

    if (!response.ok) {
        throw new Error(
            `Agent server error: ${response.status}`
        );
    }

    const plan = await response.json();

    return plan;
}

module.exports = {
    createPlan
};
