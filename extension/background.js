const SERVER_URL = "http://127.0.0.1:8001";

const ALLOWED_ACTIONS = [
    "click",
    "type",
    "scroll",
    "navigate",
    "wait",
    "noop"
];


// ==================================================
// EXTENSION INSTALL
// ==================================================

chrome.runtime.onInstalled.addListener(() => {
    console.log("PrivAgent installed successfully.");
});


// ==================================================
// MESSAGE HANDLER
// ==================================================

chrome.runtime.onMessage.addListener(
    (message, sender, sendResponse) => {

        if (!message || !message.type) {
            sendResponse({
                success: false,
                error: "Invalid message."
            });

            return;
        }


        // ------------------------------------------
        // CHECK SERVER
        // ------------------------------------------

        if (message.type === "CHECK_SERVER") {

            checkServer()
                .then(sendResponse)
                .catch(error => {

                    console.error(
                        "Server check error:",
                        error
                    );

                    sendResponse({
                        success: false,
                        error: error.message
                    });
                });

            return true;
        }


        // ------------------------------------------
        // RUN AGENT
        // ------------------------------------------

        if (message.type === "RUN_AGENT") {

            runAgent(message)
                .then(sendResponse)
                .catch(error => {

                    console.error(
                        "Agent error:",
                        error
                    );

                    sendResponse({
                        success: false,
                        error: error.message
                    });
                });

            return true;
        }
        // ------------------------------------------
        // CAPTURE SCREENSHOT (LOCAL ONLY)
        // ------------------------------------------

        if (message.type === "CAPTURE_SCREENSHOT") {
            console.log("CAPTURE_SCREENSHOT request received");
            chrome.tabs.query(
                { active: true, lastFocusedWindow: true },
                (tabs) => {
                    if (chrome.runtime.lastError) {
                        sendResponse({
                            success: false,
                            error: chrome.runtime.lastError.message
                        });
                        return;
                    }

                    if (!tabs || !tabs[0]) {
                        sendResponse({
                            success: false,
                            error: "No active tab found."
                        });
                        return;
                    }

                    chrome.tabs.captureVisibleTab(
                        tabs[0].windowId,
                        { format: "png" },
                        (dataUrl) => {
                            if (chrome.runtime.lastError) {
                                sendResponse({
                                    success: false,
                                    error: chrome.runtime.lastError.message
                                });
                                return;
                            }

                            if (!dataUrl) {
                                sendResponse({
                                    success: false,
                                    error: "Screenshot capture returned no image."
                                });
                                return;
                            }

                            sendResponse({
                                success: true,
                                dataUrl: dataUrl
                            });
                        }
                    );
                }
            );

            return true;
        }


        // ------------------------------------------
        // EXECUTE ACTION
        // ------------------------------------------

        if (message.type === "EXECUTE_ACTION") {

            executeAction(message.action, message.tabId)
                .then(sendResponse)
                .catch(error => {

                    console.error(
                        "Execution error:",
                        error
                    );

                    sendResponse({
                        success: false,
                        error: error.message
                    });
                });

            return true;
        }


        sendResponse({
            success: false,
            error: "Unknown message type."
        });
    }
);


// ==================================================
// SERVER HEALTH CHECK
// ==================================================

async function checkServer() {

    const response =
        await fetch(`${SERVER_URL}/health`);


    if (!response.ok) {
        throw new Error(
            `Server returned ${response.status}`
        );
    }


    const data =
        await response.json();


    return {
        success: true,
        server: data
    };
}


// ==================================================
// RESOLVE UNAMBIGUOUS ACTION CANDIDATES
// ==================================================

function applyCandidateResolution(action, resolution) {
    if (resolution?.isAmbiguous || resolution?.notFound) {
        return { action: "noop", requires_confirmation: false };
    }
    const candidate = resolution?.candidates?.[0];
    if (candidate?.action === "click" && candidate.selector) {
        return {
            ...action,
            action: "click",
            selector: candidate.selector,
            product: candidate.product || (candidate.product === undefined ? action?.product : null),
            url: null,
            requires_confirmation: false
        };
    }
    if (candidate?.action === "type" && candidate.selector) {
        return {
            ...action,
            action: "type",
            selector: candidate.selector,
            value: candidate.value !== undefined ? candidate.value : (action?.value || ""),
            submit: candidate.submit !== undefined ? candidate.submit : (action?.submit || false),
            url: null,
            requires_confirmation: false
        };
    }
    return action;
}

function resolveUnambiguousCandidates(goal, visibleControls) {

    if (!goal || typeof goal !== "string" || !Array.isArray(visibleControls)) {
        return { candidates: [], isAmbiguous: false };
    }

    const cleanGoal = goal.toLowerCase().trim();

    const actionWords = new Set([
        "click", "press", "tap", "select", "open", "choose", "check", "uncheck",
        "toggle", "view", "type", "enter", "fill", "input", "add", "put", "buy",
        "order", "purchase", "get", "pick", "search"
    ]);

    const stopWords = new Set([
        "the", "a", "an", "to", "in", "on", "into", "for", "of", "and", "please",
        "my", "me", "this", "that", "cart", "bag", "basket", "item", "button",
        "link", "tab", "checkbox", "radio", "menuitem", "textbox"
    ]);

    // Check for search intent: "search [site] for [query]" or "search for [query]"
    const searchMatch = cleanGoal.match(/^(?:please\s+)?search(?:\s+[a-z0-9_\-\.]+)?\s+for\s+(.+)$/i);
    if (searchMatch) {
        const query = searchMatch[1].trim();
        const searchInput = visibleControls.find(c =>
            c && c.selector && c.enabled !== false && c.visible !== false &&
            (
                (c.type || "").toLowerCase() === "search" ||
                (c.role || "").toLowerCase() === "searchbox" ||
                /\bsearch\b/i.test(c.label || "") ||
                /\bsearch\b/i.test(c.ariaLabel || "") ||
                /search/i.test(c.selector || "")
            ) &&
            ((c.role || "").toLowerCase() === "textbox" || ["input", "textarea", "search"].includes((c.type || "").toLowerCase()))
        );

        if (searchInput) {
            return {
                candidates: [
                    {
                        action: "type",
                        selector: searchInput.selector,
                        value: query,
                        submit: true
                    }
                ],
                isAmbiguous: false,
                notFound: false
            };
        }
    }

    // Check for typing intent: "type [val] into/in [target]"
    const isTypeIntent = /^(?:please\s+)?(?:type|enter|fill|input)\b/i.test(cleanGoal);
    if (isTypeIntent) {
        const withoutVerb = cleanGoal.replace(/^(?:please\s+)?(?:type|enter|fill|input)\s+/i, "");
        const sepMatch = withoutVerb.match(/^(.+?)\s+(?:into|in)\s+(.+)$/i);
        if (sepMatch) {
            const typeValue = sepMatch[1].trim();
            const rawTarget = sepMatch[2].trim();
            const cleanTarget = rawTarget
                .replace(/^(?:the\s+|a\s+|an\s+)/i, "")
                .replace(/\s+(?:field|input|box|textbox|text\s*box|searchbox|search\s*box)$/i, "")
                .trim();
            const targetWords = cleanTarget.replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);
            const targetPhrase = targetWords.join(" ");

            const textboxControls = visibleControls.filter(c =>
                c && c.selector && c.enabled !== false && c.visible !== false &&
                ((c.role || "").toLowerCase() === "textbox" || ["input", "textarea", "search"].includes((c.type || "").toLowerCase()))
            );

            const scoredTextboxes = [];
            for (const tb of textboxControls) {
                const rawL = (tb.label || "").toLowerCase().trim();
                const rawA = (tb.ariaLabel || "").toLowerCase().trim();
                const l = rawL.replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
                const a = rawA.replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();

                let score = 0;
                if (targetPhrase && (l === targetPhrase || a === targetPhrase)) {
                    score += 50;
                } else if (targetPhrase && (l.includes(targetPhrase) || a.includes(targetPhrase) || targetPhrase.includes(l))) {
                    score += 30;
                }
                let wm = 0;
                for (const tw of targetWords) {
                    if (!stopWords.has(tw) && (l.includes(tw) || a.includes(tw))) {
                        wm++;
                    }
                }
                if (wm > 0) score += wm * 5;
                if (tb.selector && targetPhrase && tb.selector.toLowerCase().includes(targetPhrase)) {
                    score += 10;
                }
                if (score > 0) {
                    scoredTextboxes.push({ control: tb, score });
                }
            }

            if (scoredTextboxes.length > 0) {
                scoredTextboxes.sort((x, y) => y.score - x.score);
                const best = scoredTextboxes[0].score;
                const top = scoredTextboxes.filter(i => i.score === best);
                if (top.length === 1) {
                    return {
                        candidates: [
                            {
                                action: "type",
                                selector: top[0].control.selector,
                                value: typeValue
                            }
                        ],
                        isAmbiguous: false,
                        notFound: false
                    };
                } else if (top.length > 1) {
                    return {
                        candidates: [],
                        isAmbiguous: true,
                        notFound: false
                    };
                }
            }
        }
    }

    const rawWords = cleanGoal
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter(Boolean);

    const hasActionIntent = rawWords.some(w => actionWords.has(w));
    if (!hasActionIntent) {
        return { candidates: [], isAmbiguous: false };
    }

    // 1. Identify semantic noun constraints
    let semanticConstraint = null;
    if (/\b(?:button|btn)\b/i.test(cleanGoal)) {
        semanticConstraint = "button";
    } else if (/\b(?:link|hyperlink)\b/i.test(cleanGoal)) {
        semanticConstraint = "link";
    } else if (/\b(?:tab)\b/i.test(cleanGoal)) {
        semanticConstraint = "tab";
    } else if (/\b(?:checkbox|check\s*box)\b/i.test(cleanGoal)) {
        semanticConstraint = "checkbox";
    } else if (/\b(?:radio(?:\s*button)?)\b/i.test(cleanGoal)) {
        semanticConstraint = "radio";
    } else if (/\b(?:menu\s*item|menuitem)\b/i.test(cleanGoal)) {
        semanticConstraint = "menuitem";
    } else if (/\b(?:textbox|text\s*box|searchbox|search\s*box|input|field)\b/i.test(cleanGoal)) {
        semanticConstraint = "textbox";
    }

    // 2. Extract core target phrase
    let strippedTarget = cleanGoal
        .replace(/^(?:please\s+)?(?:click|press|tap|select|open|choose|check|uncheck|toggle|add|put|buy|order|purchase|get|pick)\s+(?:on\s+|the\s+)?/i, "")
        .replace(/\s+(?:button|btn|link|checkbox|check\s*box|tab|menu\s*item|menuitem|radio(?:\s*button)?|textbox|text\s*box|input|field)$/i, "")
        .replace(/^(?:the\s+)/i, "")
        .trim();

    const isCartIntent = /^(?:please\s+)?(?:add|put|buy|purchase|order)\b/i.test(cleanGoal) || /\badd\s+(?:to\s+)?(?:the\s+)?(?:cart|bag|basket)\b/i.test(cleanGoal);
    if (isCartIntent) {
        strippedTarget = strippedTarget
            .replace(/^to\s+(?:the\s+)?(?:cart|bag|basket)\s*/i, "")
            .replace(/\s+to\s+(?:the\s+)?(?:cart|bag|basket)$/i, "")
            .trim();
    }

    const exactTargetWords = strippedTarget
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter(Boolean);
    const exactTargetPhrase = exactTargetWords.join(" ");

    const subjectWords = rawWords.filter(
        w => !actionWords.has(w) && !stopWords.has(w) && w.length > 1
    );

    const clickableControls = visibleControls.filter(
        c => c && c.selector && c.enabled !== false && c.visible !== false && c.width !== 0 && c.height !== 0
    );

    // If generic command with no target discriminating words
    if (subjectWords.length === 0 && !exactTargetPhrase) {
        if (clickableControls.length > 1) {
            return { candidates: [], isAmbiguous: true };
        }
        if (clickableControls.length === 1) {
            return {
                candidates: [{ action: "click", selector: clickableControls[0].selector }],
                isAmbiguous: false
            };
        }
        return { candidates: [], isAmbiguous: false };
    }

    const subjectPhrase = subjectWords.join(" ");

    const containsPhrase = (text, phrase) => Boolean(
        phrase && (` ${text} `).includes(` ${phrase} `)
    );
    const scoredControls = [];

    for (const control of clickableControls) {
        const rawLabel = (control.label || "").toLowerCase();
        const rawAriaLabel = (control.ariaLabel || "").toLowerCase();
        if (!rawLabel && !rawAriaLabel) continue;

        const label = rawLabel
            .replace(/[^a-z0-9\s]/g, " ")
            .replace(/\s+/g, " ")
            .trim();
        const ariaLabel = rawAriaLabel
            .replace(/[^a-z0-9\s]/g, " ")
            .replace(/\s+/g, " ")
            .trim();

        const controlRole = (control.role || control.type || "").toLowerCase().trim();
        const isButtonType = controlRole === "button" || control.type === "button" || control.type === "submit";
        const isLinkType = controlRole === "link" || control.type === "a";
        const isCheckboxType = controlRole === "checkbox" || control.type === "checkbox";
        const isTabType = controlRole === "tab";
        const isMenuItemType = controlRole === "menuitem";
        const isTextboxType = (controlRole === "textbox" || control.type === "input" || control.type === "textarea" || control.type === "search") && !isButtonType;

        // Reject semantically incompatible candidates before scoring
        if (semanticConstraint) {
            if (semanticConstraint === "button") {
                if (isTextboxType) {
                    continue;
                }
            } else if (semanticConstraint === "link") {
                if (isButtonType || isTextboxType) {
                    continue;
                }
            } else if (semanticConstraint === "textbox") {
                if (isButtonType || isLinkType) {
                    continue;
                }
            } else if (semanticConstraint === "checkbox" && !isCheckboxType) {
                continue;
            } else if (semanticConstraint === "tab" && !isTabType) {
                continue;
            } else if (semanticConstraint === "menuitem" && !isMenuItemType) {
                continue;
            }
        }

        let score = 0;

        // 1. Exact textual match against primary label or accessible name
        if (exactTargetPhrase && (label === exactTargetPhrase || ariaLabel === exactTargetPhrase)) {
            score += 50;
        } else if (subjectPhrase && (label === subjectPhrase || ariaLabel === subjectPhrase)) {
            score += 45;
        } else if (exactTargetPhrase && (containsPhrase(label, exactTargetPhrase) || containsPhrase(ariaLabel, exactTargetPhrase))) {
            score += 25;
        } else if (subjectPhrase && (containsPhrase(label, subjectPhrase) || containsPhrase(ariaLabel, subjectPhrase))) {
            score += 20;
        }

        // 2. Significant word matching if no exact phrase match
        let wordMatches = 0;
        const targetWordsToMatch = exactTargetWords.length > 0 ? exactTargetWords : subjectWords;
        // Exclude generic action verbs (e.g. 'view', 'click', 'open') from individual word matching
        // when discriminating non-action target words exist, preventing unrelated links containing action verbs
        // from receiving false matches and triggering ambiguity.
        const nonActionTargetWords = targetWordsToMatch.filter(
            w => !actionWords.has(w) && !stopWords.has(w)
        );
        const wordsToMatch = nonActionTargetWords.length > 0
            ? nonActionTargetWords
            : targetWordsToMatch.filter(w => !stopWords.has(w));

        for (const word of wordsToMatch) {
            if (!stopWords.has(word) && (label.split(/\s+/).includes(word) || ariaLabel.split(/\s+/).includes(word))) {
                wordMatches++;
            }
        }
        if (score === 0 && wordMatches > 0) {
            const labelIsSubphrase = label.length >= 3 && !actionWords.has(label) && !stopWords.has(label) && (
                (exactTargetPhrase && containsPhrase(exactTargetPhrase, label)) ||
                (subjectPhrase && containsPhrase(subjectPhrase, label))
            );
            if (wordsToMatch.length >= 2 && wordMatches < 2 && !labelIsSubphrase) {
                wordMatches = 0;
            } else {
                score += wordMatches * 3;
                if (labelIsSubphrase) {
                    score += 15;
                }
                if (nonActionTargetWords.length > 0 && wordMatches === nonActionTargetWords.length) {
                    score += 10;
                } else if (subjectWords.length > 0 && wordMatches === subjectWords.length) {
                    score += 10;
                }
            }
        }

        // 3. TestId or Selector Slug match
        const testIdMatch = (control.selector || "").match(/data-testid=["']?([^"']+)["']?/i);
        if (testIdMatch && testIdMatch[1]) {
            const testIdSlug = testIdMatch[1].toLowerCase().replace(/[^a-z0-9\s]/g, " ");
            if (exactTargetPhrase && testIdSlug.includes(exactTargetPhrase)) {
                score += 10;
            } else if (subjectPhrase && testIdSlug.includes(subjectPhrase)) {
                score += 5;
            }
        }

        // 4. Whole user goal alignment bonus
        const isSolelyActionVerb = actionWords.has(label);
        if (label.length >= 3 && (!isSolelyActionVerb || label === exactTargetPhrase)) {
            if (containsPhrase(cleanGoal, label) || (exactTargetPhrase && containsPhrase(label, exactTargetPhrase))) {
                if (score > 0 || label === exactTargetPhrase) {
                    score += 10;
                }
            }
        }

        if (score > 0) {
            // 5. Visibility and Enabled bonuses
            if (control.visible !== false) {
                score += 10;
            } else {
                score -= 40;
            }
            if (control.enabled !== false) {
                score += 10;
            } else {
                score -= 40;
            }

            // 6. Semantic noun constraint evaluation
            if (semanticConstraint) {
                if (semanticConstraint === "button") {
                    if (isButtonType) {
                        score += 30;
                    } else if (isTextboxType) {
                        // A requested button must not resolve to a textbox or input
                        continue;
                    } else if (isLinkType) {
                        score -= 30;
                    } else {
                        score -= 20;
                    }
                } else if (semanticConstraint === "link") {
                    if (isLinkType) {
                        score += 30;
                    } else if (isButtonType) {
                        // A requested link must not resolve to a button
                        continue;
                    } else if (isTextboxType) {
                        continue;
                    } else {
                        score -= 20;
                    }
                } else if (semanticConstraint === "textbox") {
                    if (isTextboxType) {
                        score += 30;
                    } else if (isButtonType || isLinkType) {
                        continue;
                    } else {
                        score -= 20;
                    }
                } else if (semanticConstraint === "tab") {
                    if (isTabType) {
                        score += 30;
                    } else {
                        score -= 20;
                    }
                } else if (semanticConstraint === "checkbox") {
                    if (isCheckboxType) {
                        score += 30;
                    } else {
                        score -= 20;
                    }
                } else if (semanticConstraint === "menuitem") {
                    if (isMenuItemType) {
                        score += 30;
                    } else {
                        score -= 20;
                    }
                }
            } else {
                if (isButtonType) {
                    score += 5;
                }
            }

            // 7. Cart action intent weighting
            const hasActionWordInLabel = /\badd\b|\bcart\b|\bbag\b|\bbuy\b|\bpurchase\b|\border\b/i.test(label);
            if (isCartIntent) {
                if (!isButtonType && !hasActionWordInLabel) {
                    continue;
                }
                if (hasActionWordInLabel) {
                    score += 8;
                }
                if (isButtonType) {
                    score += 4;
                }
            }

            scoredControls.push({ control, score, wordMatches });
        }
    }

    if (scoredControls.length === 0) {
        return {
            candidates: [],
            isAmbiguous: false,
            notFound: isCartIntent,
            product: exactTargetPhrase || subjectPhrase
        };
    }

    scoredControls.sort((a, b) => b.score - a.score);

    const bestScore = scoredControls[0].score;

    console.info?.("PrivAgent target candidates", {
        goal: cleanGoal,
        candidates: scoredControls
            .filter(({ score }) => score >= bestScore - 15)
            .map(({ control, score }) => ({
                label: control.label,
                selector: control.selector,
                type: control.type,
                role: control.role,
                score
            }))
    });
    if (bestScore <= 0) {
        return {
            candidates: [],
            isAmbiguous: false,
            notFound: true,
            product: exactTargetPhrase || subjectPhrase
        };
    }

    const topMatches = scoredControls.filter(item => item.score === bestScore);

    if (topMatches.length === 1) {
        if (scoredControls.length > 1) {
            const runnerUp = scoredControls[1];
            if (
                bestScore - runnerUp.score <= 5 &&
                runnerUp.score > 30 &&
                runnerUp.control.label === topMatches[0].control.label
            ) {
                return {
                    candidates: [],
                    isAmbiguous: true,
                    notFound: false,
                    product: exactTargetPhrase || subjectPhrase
                };
            }
        }

        console.info?.("PrivAgent selected target", {
            label: topMatches[0].control.label,
            selector: topMatches[0].control.selector,
            type: topMatches[0].control.type,
            role: topMatches[0].control.role,
            product: exactTargetPhrase || subjectPhrase
        });

        return {
            candidates: [
                {
                    action: "click",
                    selector: topMatches[0].control.selector,
                    product: isCartIntent ? (exactTargetPhrase || subjectPhrase) : null
                }
            ],
            isAmbiguous: false,
            notFound: false
        };
    }

    // Multiple equal matches -> ambiguous
    return {
        candidates: [],
        isAmbiguous: true,
        notFound: false,
        product: exactTargetPhrase || subjectPhrase
    };
}


// ==================================================
// RUN PRIVAGENT
// ==================================================

async function runAgent(message) {

    // ----------------------------------------------
    // VALIDATE COMMAND
    // ----------------------------------------------

    if (
        !message.command ||
        typeof message.command !== "string"
    ) {

        throw new Error(
            "Agent command is required."
        );
    }


    // ----------------------------------------------
    // VALIDATE SANITIZED CONTEXT
    // ----------------------------------------------

    if (
        !message.sanitizedContext ||
        typeof message.sanitizedContext !== "object"
    ) {

        throw new Error(
            "Sanitized context is required."
        );
    }


    const page =
        message.sanitizedContext;


    // ==================================================
    // CONVERT PAGE ELEMENTS INTO SERVER FORMAT
    // ==================================================

    const visibleControls =
        Array.isArray(page.elements)
            ? page.elements.map(element => {

                return {

                    type:
                        element.type ||
                        "unknown",

                    role:
                        element.role ||
                        "",

                    label:
                        element.label ||
                        "",

                    ariaLabel:
                        element.ariaLabel ||
                        "",

                    selector:
                        element.selector ||
                        null,

                    enabled:
                        element.enabled !== false,

                    visible:
                        element.visible !== false
                };

            })
            : [];


    // ==================================================
    // SAFE LABELS
    // ==================================================

    const safeLabels = [];


    if (page.title) {

        safeLabels.push({

            text:
                page.title,

            role:
                "page_title",

            selector:
                null
        });
    }


    // ==================================================
    // RESOLVE UNAMBIGUOUS ACTION CANDIDATES
    // ==================================================

    const candidateResolution =
        resolveUnambiguousCandidates(
            message.command,
            visibleControls
        );


    // ==================================================
    // BUILD EXACT SanitizedContext EXPECTED BY FASTAPI
    // ==================================================

    const context = {

        goal:
            message.command.trim(),

        visible_controls:
            visibleControls,

        safe_labels:
            safeLabels,

        redacted_regions:
            [],

        action_candidates:
            candidateResolution.candidates
    };


    console.log(
        "PrivAgent sanitized request:",
        context
    );


    // ==================================================
    // SEND SANITIZED CONTEXT TO SERVER
    // ==================================================

    const response =
        await fetch(
            `${SERVER_URL}/agent`,
            {

                method: "POST",

                headers: {
                    "Content-Type":
                        "application/json"
                },

                body:
                    JSON.stringify(context)
            }
        );


    // ==================================================
    // HANDLE SERVER ERRORS
    // ==================================================

    if (!response.ok) {

        let errorMessage =
            `Server returned ${response.status}`;


        try {

            const errorData =
                await response.json();


            if (errorData.detail) {

                if (
                    typeof errorData.detail ===
                    "string"
                ) {

                    errorMessage =
                        errorData.detail;

                } else {

                    errorMessage =
                        JSON.stringify(
                            errorData.detail,
                            null,
                            2
                        );
                }
            }

        } catch (error) {

            console.error(
                "Could not parse server error:",
                error
            );
        }


        throw new Error(
            errorMessage
        );
    }


    // ==================================================
    // READ SERVER RESPONSE
    // ==================================================

    const result =
        await response.json();


    console.log(
        "PrivAgent server response:",
        result
    );


    // ==================================================
    // VALIDATE SERVER RESPONSE
    // ==================================================

    if (!result.action) {

        throw new Error(
            "Server returned no action."
        );
    }


    if (
        !result.action.action ||
        !ALLOWED_ACTIONS.includes(
            result.action.action
        )
    ) {

        throw new Error(
            `Blocked unsupported action: ${
                result.action.action ||
                "unknown"
            }`
        );
    }


    result.action = applyCandidateResolution(result.action, candidateResolution);


    // ==================================================
    // RETURN APPROVED ACTION TO POPUP
    // ==================================================

    return {

        success: true,

        message:
            candidateResolution.isAmbiguous && result.action?.action === "noop"
                ? "Target is ambiguous: multiple matching elements found."
                : (candidateResolution.notFound && result.action?.action === "noop"
                    ? `Could not identify an Add to Cart button for "${candidateResolution.product}".`
                    : (result.message || "")),

        action:
            result.action,

        ambiguous:
            candidateResolution.isAmbiguous,

        notFound:
            candidateResolution.notFound,

        requiresConfirmation:
            result.action
                .requires_confirmation === true
    };
}


// ==================================================
// EXECUTE APPROVED ACTION
// ==================================================

async function executeAction(action, targetTabId) {

    // ----------------------------------------------
    // VALIDATE ACTION
    // ----------------------------------------------

    if (
        !action ||
        !action.action
    ) {

        throw new Error(
            "Invalid action."
        );
    }


    if (
        !ALLOWED_ACTIONS.includes(
            action.action
        )
    ) {

        throw new Error(
            `Blocked unsupported action: ${action.action}`
        );
    }


    // ==================================================
    // NOOP
    // ==================================================

    if (action.action === "noop") {

        return {
            success: true,
            action: "noop"
        };
    }


    // ==================================================
    // WAIT
    // ==================================================

    if (action.action === "wait") {

        return {
            success: true,
            action: "wait"
        };
    }


    // ==================================================
    // RESOLVE AND VALIDATE TARGET TAB
    // ==================================================

    let tabId = targetTabId;

    if (tabId !== undefined && tabId !== null) {

        if (
            typeof tabId !== "number" ||
            !Number.isInteger(tabId) ||
            tabId < 0
        ) {
            throw new Error(
                `Invalid tab ID provided: ${tabId}`
            );
        }

        try {
            const tab = await chrome.tabs.get(tabId);

            if (!tab) {
                throw new Error(
                    `Target tab ${tabId} does not exist.`
                );
            }
        } catch (tabError) {
            throw new Error(
                `Target tab ${tabId} is unavailable: ${tabError.message}`
            );
        }

    } else {

        const tabs =
            await chrome.tabs.query({
                active: true,
                currentWindow: true
            });

        if (!tabs.length || !tabs[0].id) {

            throw new Error(
                "No active tab found."
            );
        }

        tabId = tabs[0].id;
    }


    // ==================================================
    // NAVIGATION
    // ==================================================

    if (action.action === "navigate") {

        if (!action.url) {

            throw new Error(
                "Navigation URL is missing."
            );
        }


        if (
            !/^https?:\/\//i.test(
                action.url
            )
        ) {

            throw new Error(
                "Only HTTP/HTTPS navigation is allowed."
            );
        }


        await chrome.tabs.update(
            tabId,
            {
                url:
                    action.url
            }
        );


        return {
            success: true,
            action: "navigate"
        };
    }


    // ==================================================
    // SEND ACTION TO CONTENT.JS
    // ==================================================

    let result;

    try {

        result =
            await chrome.tabs.sendMessage(
                tabId,
                {
                    type:
                        "EXECUTE_BROWSER_ACTION",

                    action:
                        action
                }
            );

    } catch (sendError) {

        // Fallback: inject content script if not connected
        try {

            await chrome.scripting.executeScript({
                target: {
                    tabId: tabId
                },
                files: ["privacy-gate.js"]
            });

            await chrome.scripting.executeScript({
                target: {
                    tabId: tabId
                },
                files: ["content.js"]
            });

            result =
                await chrome.tabs.sendMessage(
                    tabId,
                    {
                        type:
                            "EXECUTE_BROWSER_ACTION",

                        action:
                            action
                    }
                );

        } catch (injectionError) {

            throw new Error(
                `Content script unavailable in tab ${tabId}: ${sendError.message}`
            );
        }
    }


    if (!result) {

        throw new Error(
            "No response from browser executor."
        );
    }


    if (result.success === false) {

        throw new Error(
            result.error ||
            "Browser action failed."
        );
    }


    return result;
}


if (typeof module !== "undefined" && module.exports) {
    module.exports = {
        checkServer,
        runAgent,
        executeAction,
        resolveUnambiguousCandidates,
        applyCandidateResolution,
        ALLOWED_ACTIONS
    };
}
