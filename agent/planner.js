function createPlan(userCommand, pageState) {
    const command = userCommand.toLowerCase();

    if (command.includes("search")) {
        const searchBox = pageState.elements?.find(
            element =>
                element.type === "input" &&
                element.label?.toLowerCase().includes("search")
        );

        if (searchBox) {
            return {
                action: "type",
                target: searchBox.id,
                value: userCommand
            };
        }
    }

    return {
        action: "wait",
        target: null,
        value: null
    };
}

module.exports = {
    createPlan
};
