const ALLOWED_FIELDS = [
    "title",
    "url",
    "text",
    "elements",
    "role",
    "type",
    "label"
];

function applyPrivacyPolicy(pageState) {
    if (!pageState || typeof pageState !== "object") {
        return {
            allowed: false,
            reason: "Invalid page state"
        };
    }

    const sanitizedState = {};

    for (const field of ALLOWED_FIELDS) {
        if (pageState[field] !== undefined) {
            sanitizedState[field] = pageState[field];
        }
    }

    return {
        allowed: true,
        state: sanitizedState
    };
}

module.exports = {
    applyPrivacyPolicy
};
