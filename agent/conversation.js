function createConversation() {
    return {
        messages: []
    };
}

function addUserMessage(conversation, message) {
    conversation.messages.push({
        role: "user",
        content: message
    });

    return conversation;
}

function addAgentMessage(conversation, message) {
    conversation.messages.push({
        role: "assistant",
        content: message
    });

    return conversation;
}

function getConversationHistory(conversation) {
    return conversation.messages;
}

module.exports = {
    createConversation,
    addUserMessage,
    addAgentMessage,
    getConversationHistory
};
