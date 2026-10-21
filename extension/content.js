// ============================================================
// PRIVAGENT CONTENT SCRIPT
// ============================================================

console.log("PrivAgent content script loaded.");


// ------------------------------------------------------------
// PAGE STATE
// ------------------------------------------------------------

function getPageState() {

    const elements = findInteractiveElements();

    const rawPageState = {
        title: document.title,
        url: window.location.href,
        text: document.body?.innerText || "",
        elements: elements
    };

    // Keep raw page data inside the browser.
    // Only sanitized data is returned.
    if (
        typeof PrivAgentPrivacy === "undefined" ||
        typeof PrivAgentPrivacy.sanitizePageState !== "function"
    ) {
        console.error("PrivAgent Privacy Gate is not available.");

        return {
            title: "",
            url: "",
            text: "",
            elements: []
        };
    }

    return PrivAgentPrivacy.sanitizePageState(rawPageState);
}

function isValidProductTitle(text) {
    if (!text || typeof text !== "string") {
        return false;
    }
    const clean = text.trim();
    if (clean.length < 2 || clean.length > 100) {
        return false;
    }
    // Exclude currency and standalone price strings
    if (/^\$?[\d,.]+(\s*[A-Z]{3})?$/.test(clean)) {
        return false;
    }
    // Exclude action button and checkout navigation text
    if (/^(add\s+to|buy\s+now|order\s+now|add\s+item|view\s+details|shop\s+now|checkout|remove|cart|bag|subscribe)/i.test(clean)) {
        return false;
    }
    return true;
}


// ------------------------------------------------------------
// FIND PRODUCT TITLE (Tight container, no broad section mixing)
// ------------------------------------------------------------

function findProductTitle(element) {

    if (!element) {
        return "";
    }

    // 1. Direct dataset or aria attributes on the element
    if (element.dataset?.product) {
        return String(element.dataset.product).trim();
    }
    if (element.dataset?.productName) {
        return String(element.dataset.productName).trim();
    }
    if (element.dataset?.productTitle) {
        return String(element.dataset.productTitle).trim();
    }

    if (typeof element.getAttribute === "function") {
        const ariaLabel = element.getAttribute("aria-label");
        if (ariaLabel && /add\b/i.test(ariaLabel)) {
            const cleaned = ariaLabel
                .replace(/^add\s+(to\s+(?:cart|bag)\s+)?/i, "")
                .replace(/\s+to\s+(?:cart|bag)$/i, "")
                .trim();
            if (isValidProductTitle(cleaned)) {
                return cleaned;
            }
        }

        const descId = element.getAttribute("aria-describedby");
        if (descId && typeof document !== "undefined" && typeof document.getElementById === "function") {
            const descEl = document.getElementById(descId);
            if (descEl && descEl.innerText) {
                const t = String(descEl.innerText).trim();
                if (isValidProductTitle(t)) {
                    return t;
                }
            }
        }
    }

    // 2. Check preceding siblings (handles flat product layouts and heading+button pairs)
    let sibling = element.previousElementSibling;
    while (sibling) {
        const sibTag = sibling.tagName ? String(sibling.tagName).toUpperCase() : "";
        if (
            /^H[1-6]$/.test(sibTag) ||
            sibTag === "A" ||
            sibling.classList?.contains?.("title") ||
            sibling.classList?.contains?.("product-title") ||
            sibling.classList?.contains?.("card-title")
        ) {
            const t = String(sibling.innerText || "").trim();
            if (isValidProductTitle(t)) {
                return t;
            }
        }
        if (typeof sibling.querySelector === "function") {
            const nestedHeading = sibling.querySelector(
                "h1, h2, h3, h4, h5, h6, .card-title, .product-title, .item-title, [class*='title'], [class*='name'], a"
            );
            if (nestedHeading && nestedHeading !== element && nestedHeading.innerText) {
                const t = String(nestedHeading.innerText).trim();
                if (isValidProductTitle(t)) {
                    return t;
                }
            }
        }
        sibling = sibling.previousElementSibling;
    }

    // 3. Walk up the ancestor tree to find the tightest product wrapper.
    // Strictly avoid broad page sections (like SECTION, MAIN, BODY, HTML) or containers
    // that contain multiple distinct product titles or cards.
    const broadTags = new Set(["BODY", "MAIN", "SECTION", "HTML", "FORM"]);
    let curr = element.parentElement;

    while (curr && curr !== document.body && curr !== document.documentElement) {
        const currTag = curr.tagName ? String(curr.tagName).toUpperCase() : "";

        if (broadTags.has(currTag)) {
            // Do not use broad page sections as a single product container
            break;
        }

        // If curr contains multiple product cards, it is a multi-product container
        if (typeof curr.querySelectorAll === "function") {
            const nestedCards = curr.querySelectorAll(
                ".card, .product-card, .product-item, .product, article"
            );
            if (nestedCards.length > 1) {
                break;
            }

            const actionButtons = curr.querySelectorAll(
                "button, input[type='submit'], [data-testid*='add-'], [data-testid*='buy-']"
            );
            if (actionButtons.length > 1) {
                break;
            }
        }

        if (curr.dataset?.product) {
            return String(curr.dataset.product).trim();
        }
        if (curr.dataset?.productName) {
            return String(curr.dataset.productName).trim();
        }
        if (curr.dataset?.productTitle) {
            return String(curr.dataset.productTitle).trim();
        }

        if (typeof curr.querySelectorAll === "function") {
            const titleCandidates = curr.querySelectorAll(
                "h1, h2, h3, h4, h5, h6, .card-title, .product-title, .item-title, [class*='title'], [class*='name']"
            );
            for (const candidate of titleCandidates) {
                if (candidate && candidate !== element && candidate.innerText) {
                    const titleText = String(candidate.innerText).trim();
                    if (isValidProductTitle(titleText)) {
                        return titleText;
                    }
                }
            }
        }

        if (typeof curr.querySelector === "function") {
            const titleEl = curr.querySelector(
                ".card-title, .product-title, .item-title, .title, [class*='title'], [class*='name'], h1, h2, h3, h4, h5, h6, strong, b, a"
            );

            if (titleEl && titleEl !== element && titleEl.innerText) {
                const titleText = String(titleEl.innerText).trim();
                if (isValidProductTitle(titleText)) {
                    return titleText;
                }
            }

            const img = curr.querySelector("img[alt]");
            if (img && typeof img.getAttribute === "function" && img.getAttribute("alt")) {
                const altText = String(img.getAttribute("alt")).trim();
                if (isValidProductTitle(altText)) {
                    return altText;
                }
            }
        }

        curr = curr.parentElement;
    }

    // 4. Stable data-testid fallback on the element itself (e.g. data-testid="add-playwright-api-ui-bundle")
    const testId =
        (typeof element.getAttribute === "function" && element.getAttribute("data-testid")) ||
        element.dataset?.testid;
    if (testId && typeof testId === "string") {
        const cleanTestId = testId.trim();
        const actionMatch = cleanTestId.match(/^(?:add|buy|cart|btn)[-_](.+)$/i);
        const slug = actionMatch ? actionMatch[1] : cleanTestId;
        const candidateTitle = slug.replace(/[-_]+/g, " ").trim();
        if (isValidProductTitle(candidateTitle)) {
            return candidateTitle;
        }
    }

    return "";
}


function getFormOrSearchContext(element) {
    if (!element) return "";

    try {
        const formContainer =
            element.form ||
            (typeof element.closest === "function"
                ? element.closest("form, search, [role='search'], [role='form']")
                : null);

        if (formContainer) {
            // Form or search container's own accessible label
            const formAria = (typeof formContainer.getAttribute === "function" && formContainer.getAttribute("aria-label")) || "";
            if (formAria && formAria.trim()) {
                return formAria.trim();
            }

            const formLabelledBy = typeof formContainer.getAttribute === "function" && formContainer.getAttribute("aria-labelledby");
            if (formLabelledBy && typeof document !== "undefined" && typeof document.getElementById === "function") {
                const text = formLabelledBy.split(/\s+/)
                    .map(id => document.getElementById(id)?.innerText?.trim())
                    .filter(Boolean)
                    .join(" ");
                if (text) return text;
            }

            // Sibling or child search/text input inside the same form
            if (typeof formContainer.querySelector === "function") {
                const input = formContainer.querySelector("input[type='search'], input[type='text'], input:not([type])");
                if (input && input !== element) {
                    const placeholder = (typeof input.getAttribute === "function" && input.getAttribute("placeholder")) || input.placeholder || "";
                    const inputAria = (typeof input.getAttribute === "function" && input.getAttribute("aria-label")) || "";
                    const desc = inputAria || placeholder;
                    if (desc && desc.trim()) {
                        return desc.trim();
                    }
                }
            }
        }
    } catch (_) {}

    return "";
}


function getContainerContext(element) {
    const productTitle = findProductTitle(element);
    if (productTitle) {
        return productTitle;
    }
    return getFormOrSearchContext(element);
}


// ------------------------------------------------------------
// SENSITIVE EDITABLE ELEMENT DETECTION (Local Privacy Gate)
// ------------------------------------------------------------

function isSensitiveEditableElement(element, label) {
    if (!element) return false;

    const tagName = String(element.tagName || "").toUpperCase();
    const isEditable = tagName === "INPUT" || tagName === "TEXTAREA" || Boolean(element.isContentEditable);
    if (!isEditable) {
        return false;
    }

    const inputType = String(element.type || "").toLowerCase().trim();
    if (inputType === "password" || inputType === "hidden") {
        return true;
    }

    const autocomplete = String(
        (typeof element.getAttribute === "function" && element.getAttribute("autocomplete")) || ""
    ).toLowerCase();
    if (/(?:current-password|new-password|cc-number|cc-csc|cc-exp|cc-cvc|cc-type|one-time-code)/i.test(autocomplete)) {
        return true;
    }

    const id = String(element.id || "").toLowerCase();
    const name = String(
        (typeof element.getAttribute === "function" && element.getAttribute("name")) || ""
    ).toLowerCase();
    const placeholder = String(
        (typeof element.getAttribute === "function" && element.getAttribute("placeholder")) ||
        element.placeholder ||
        ""
    ).toLowerCase();
    const ariaLabel = String(
        (typeof element.getAttribute === "function" && element.getAttribute("aria-label")) || ""
    ).toLowerCase();
    const labelText = String(label || "").toLowerCase();

    const combinedDescriptors = `${id} ${name} ${placeholder} ${ariaLabel} ${labelText}`;

    const sensitivePatterns = [
        /\b(?:password|passwd)\b/i,
        /\b(?:cvv|cvc)\b/i,
        /\b(?:security\s*code)\b/i,
        /\b(?:otp|one\s*time\s*password|one\s*time\s*code|2fa|mfa)\b/i,
        /\b(?:pin|mpin|upi\s*pin|atm\s*pin)\b/i,
        /\b(?:credit\s*card|debit\s*card|card\s*number|card_number|credit_card)\b/i,
        /\b(?:account\s*number|account_number|bank\s*account)\b/i,
        /\b(?:aadhaar|pan\s*card|pan\s*number)\b/i,
        /\b(?:secret|private\s*key)\b/i,
    ];

    for (const pattern of sensitivePatterns) {
        if (pattern.test(combinedDescriptors)) {
            return true;
        }
    }

    return false;
}


// ------------------------------------------------------------
// FIND INTERACTIVE ELEMENTS
// ------------------------------------------------------------

function findInteractiveElements() {

    const selector = "button, input, select, textarea, a, [role='button'], [role='link'], [role='tab'], [role='menuitem'], [role='checkbox'], [role='radio'], [role='switch'], [role='textbox'], [role='combobox'], [role='option'], [contenteditable='true']";
    const rawElements = typeof document !== "undefined" && typeof document.querySelectorAll === "function"
        ? document.querySelectorAll(selector)
        : [];

    const interactiveControls = [];
    const seenElements = new Set();

    Array.from(rawElements).forEach((element, index) => {

        if (!element || seenElements.has(element)) {
            return;
        }
        seenElements.add(element);

        let label = "";

        // 1. Associated HTML <label>
        if (element.id && typeof document.querySelector === "function") {

            const escapedId = typeof CSS !== "undefined" && typeof CSS.escape === "function"
                ? CSS.escape(element.id)
                : element.id;

            const associatedLabel = document.querySelector(
                `label[for="${escapedId}"]`
            );

            if (associatedLabel && associatedLabel.innerText) {
                label = associatedLabel.innerText.trim();
            }
        }

        // 2. Parent label
        if (!label && typeof element.closest === "function") {

            const parentLabel = element.closest("label");

            if (parentLabel && parentLabel.innerText) {
                label = parentLabel.innerText.trim();
            }
        }

        // 3. Accessibility label
        let ariaLabel = (typeof element.getAttribute === "function" && element.getAttribute("aria-label")) || "";
        const ariaLabelledBy = (typeof element.getAttribute === "function" && element.getAttribute("aria-labelledby")) || "";
        if (ariaLabelledBy && typeof document !== "undefined" && typeof document.getElementById === "function") {
            const labelledByText = ariaLabelledBy
                .split(/\s+/)
                .map((id) => {
                    const el = document.getElementById(id);
                    return el ? (el.innerText || (typeof el.getAttribute === "function" && el.getAttribute("aria-label")) || "") : "";
                })
                .map((t) => t.trim())
                .filter(Boolean)
                .join(" ");
            if (labelledByText) {
                if (!ariaLabel) {
                    ariaLabel = labelledByText;
                }
                if (!label) {
                    label = labelledByText;
                }
            }
        }

        const visibleText = (element.innerText || element.textContent || "").trim();
        const valueText = (typeof element.value === "string" ? element.value : "").trim();
        const placeholderText = ((typeof element.getAttribute === "function" && element.getAttribute("placeholder")) || element.placeholder || "").trim();
        const titleAttr = ((typeof element.getAttribute === "function" && element.getAttribute("title")) || "").trim();

        if (!label) {
            label =
                ariaLabel ||
                visibleText ||
                valueText ||
                placeholderText ||
                titleAttr ||
                "";
        }

        label = String(label).trim();

        // Prevent password and other genuinely sensitive editable fields from being
        // included as actionable controls sent to the backend.
        if (isSensitiveEditableElement(element, label)) {
            return;
        }

        // 4. Contextual product / card labeling for buttons and links
        const tagName = (element.tagName || "").toLowerCase();
        const type = (element.type || "").toLowerCase();
        const explicitRole = typeof element.getAttribute === "function" ? (element.getAttribute("role") || "").toLowerCase().trim() : "";

        let role = explicitRole;
        if (!role) {
            if (tagName === "button" || type === "button" || type === "submit" || type === "reset") {
                role = "button";
            } else if (tagName === "a" && (typeof element.hasAttribute !== "function" || element.hasAttribute("href"))) {
                role = "link";
            } else if (tagName === "input" && type === "checkbox") {
                role = "checkbox";
            } else if (tagName === "input" && type === "radio") {
                role = "radio";
            } else if (tagName === "input" || tagName === "textarea") {
                role = "textbox";
            } else if (tagName === "select") {
                role = "combobox";
            } else {
                role = tagName;
            }
        }

        if (
            tagName === "button" ||
            tagName === "a" ||
            type === "button" ||
            type === "submit" ||
            role === "button" ||
            role === "link"
        ) {
            const contextText = getContainerContext(element);
            if (contextText) {
                if (!label) {
                    label = contextText;
                } else if (!label.toLowerCase().includes(contextText.toLowerCase())) {
                    label = `${label} - ${contextText}`;
                }
            }
        }

        const isAriaDisabled = typeof element.getAttribute === "function" && element.getAttribute("aria-disabled") === "true";
        const enabled = !element.disabled && !isAriaDisabled;
        const visible = isElementVisible(element);

        interactiveControls.push({
            id: `element_${index}`,

            type: tagName || type,

            role: role,

            label: label.trim(),

            ariaLabel: ariaLabel.trim(),

            selector: createSelector(element),

            enabled: enabled,

            visible: visible
        });

    });

    return interactiveControls;
}


// ------------------------------------------------------------
// CREATE SIMPLE SELECTOR
// ------------------------------------------------------------

function createSelector(element) {

    if (!element) return "";

    const testId =
        (typeof element.getAttribute === "function" && element.getAttribute("data-testid")) ||
        element.dataset?.testid;

    if (testId && typeof testId === "string") {
        const cleanTestId = testId.trim();
        if (/^[a-zA-Z0-9_\-:]+$/.test(cleanTestId)) {
            const escaped = typeof CSS !== "undefined" && typeof CSS.escape === "function"
                ? CSS.escape(cleanTestId)
                : cleanTestId;
            return `[data-testid="${escaped}"]`;
        }
    }

    if (element.id && typeof element.id === "string") {
        const cleanId = element.id.trim();
        if (/^[a-zA-Z0-9_\-:]+$/.test(cleanId)) {
            const escaped = typeof CSS !== "undefined" && typeof CSS.escape === "function" ? CSS.escape(cleanId) : cleanId;
            return `#${escaped}`;
        }
    }

    if (false) {
        if (!sel || typeof document === "undefined" || typeof document.querySelectorAll !== "function") return true;
        try {
            const matches = document.querySelectorAll(sel);
            return matches.length === 1 && matches[0] === element;
        } catch (_) {
            return false;
        }
    };

    if (element.id && typeof element.id === "string") {
        const cleanId = element.id.trim();
        if (/^[a-zA-Z0-9_\-:]+$/.test(cleanId)) {
            const escaped = typeof CSS !== "undefined" && typeof CSS.escape === "function" ? CSS.escape(cleanId) : cleanId;
            const idSelector = `#${escaped}`;
            if (isUnique(idSelector)) {
                return idSelector;
            }
        }
    }

    if (element) {
        const testId =
            (typeof element.getAttribute === "function" && element.getAttribute("data-testid")) ||
            element.dataset?.testid;

        if (testId && typeof testId === "string") {
            const cleanTestId = testId.trim();
            if (/^[a-zA-Z0-9_\-:]+$/.test(cleanTestId)) {
                const escaped = typeof CSS !== "undefined" && typeof CSS.escape === "function"
                    ? CSS.escape(cleanTestId)
                    : cleanTestId;
                const testIdSel = `[data-testid="${escaped}"]`;
                if (isUnique(testIdSel)) {
                    return testIdSel;
                }
            }
        }
    }

    if (element && element.dataset) {
        if (!element.dataset.privagentId) {
            element.dataset.privagentId =
                `pa-${Math.random()
                    .toString(36)
                    .slice(2, 10)}`;
        }
        if (typeof element.setAttribute === "function") {
            element.setAttribute("data-privagent-id", element.dataset.privagentId);
        }
        return `[data-privagent-id="${element.dataset.privagentId}"]`;
    }

    return "";
}


// ------------------------------------------------------------
// FIND ELEMENT BY SELECTOR
// ------------------------------------------------------------

function getElement(selector) {

    if (!selector) {
        return null;
    }

    try {
        return document.querySelector(selector);
    } catch (error) {
        console.error("Invalid selector:", selector);
        return null;
    }
}


function isElementVisible(element) {

    if (!element) {
        return false;
    }

    if (typeof element.isConnected === "boolean" && !element.isConnected) {
        return false;
    }

    // 1. Accessibility hidden / inert attribute checks
    if (element.inert === true) {
        return false;
    }

    if (typeof element.getAttribute === "function" && element.getAttribute("aria-hidden") === "true") {
        return false;
    }

    if (typeof element.closest === "function") {
        const hiddenAncestor = element.closest("[aria-hidden='true'], [inert]");
        if (
            hiddenAncestor &&
            (hiddenAncestor.inert === true ||
                (typeof hiddenAncestor.getAttribute === "function" &&
                    hiddenAncestor.getAttribute("aria-hidden") === "true"))
        ) {
            return false;
        }

        // 2. Collapsed disclosure container checks
        const details = element.closest("details");
        if (details && String(details.tagName || "").toUpperCase() === "DETAILS" && !details.open) {
            const summary = typeof details.querySelector === "function" ? details.querySelector("summary") : null;
            if (!summary || (typeof summary.contains === "function" && !summary.contains(element))) {
                return false;
            }
        }

        const collapsedAncestor = element.closest("[aria-expanded='false']");
        if (
            collapsedAncestor &&
            collapsedAncestor !== element &&
            typeof collapsedAncestor.getAttribute === "function" &&
            collapsedAncestor.getAttribute("aria-expanded") === "false"
        ) {
            return false;
        }

        // Check if inside a popup / dropdown controlled by an aria-expanded="false" toggle
        const popupMenu = element.closest("[role='menu'], [role='listbox'], [role='dialog'], .dropdown-menu, .menu, [class*='dropdown-content']");
        if (popupMenu && popupMenu.id && typeof document !== "undefined" && typeof document.querySelector === "function") {
            const escapedId = typeof CSS !== "undefined" && typeof CSS.escape === "function" ? CSS.escape(popupMenu.id) : popupMenu.id;
            const controller = document.querySelector(`[aria-expanded="false"][aria-controls="${escapedId}"]`);
            if (controller && typeof controller.contains === "function" && !controller.contains(element)) {
                return false;
            }
        }
    }

    // 3. Browser native checkVisibility if supported
    if (typeof element.checkVisibility === "function") {
        try {
            if (!element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) {
                return false;
            }
        } catch (_) {}
    }

    // 4. Computed style checks
    if (typeof window !== "undefined" && typeof window.getComputedStyle === "function") {
        const style = window.getComputedStyle(element);

        if (
            style.display === "none" ||
            style.visibility === "hidden" ||
            style.visibility === "collapse" ||
            parseFloat(style.opacity) === 0 ||
            style.pointerEvents === "none"
        ) {
            return false;
        }
    }

    // 5. Geometry and layout bounds checks
    if (typeof element.getBoundingClientRect === "function") {
        const rect = element.getBoundingClientRect();

        if (rect.width <= 0 || rect.height <= 0) {
            return false;
        }

        // Extreme off-screen positioning (e.g. left: -9999px screen-reader hidden patterns)
        if (rect.right < -500 || rect.bottom < -500) {
            return false;
        }

        // Offscreen fixed / sticky elements (e.g. unpinned sticky headers translated out of viewport)
        // Legitimate scrollable content in normal flow (position: static/relative) is preserved.
        if (typeof window !== "undefined" && typeof window.getComputedStyle === "function") {
            const style = window.getComputedStyle(element);
            const isFixedOrSticky = style.position === "fixed" || style.position === "sticky";
            let hasFixedStickyAncestor = false;
            if (!isFixedOrSticky && typeof element.closest === "function") {
                const fixedOrStickyAncestor = element.closest("[style*='fixed'], [style*='sticky'], .sticky, .fixed");
                if (fixedOrStickyAncestor) {
                    hasFixedStickyAncestor = true;
                } else {
                    const headerOrNav = element.closest("header, nav");
                    if (headerOrNav) {
                        if (headerOrNav.classList?.contains("sticky") || headerOrNav.classList?.contains("fixed") || headerOrNav.getAttribute("style")?.includes("fixed") || headerOrNav.getAttribute("style")?.includes("sticky")) {
                            hasFixedStickyAncestor = true;
                        } else if (typeof window.getComputedStyle === "function") {
                            const ancestorStyle = window.getComputedStyle(headerOrNav);
                            hasFixedStickyAncestor = ancestorStyle && (ancestorStyle.position === "fixed" || ancestorStyle.position === "sticky");
                        }
                    }
                }
            }

            if (isFixedOrSticky || hasFixedStickyAncestor) {
                const vpWidth = window.innerWidth || (typeof document !== "undefined" && document.documentElement && document.documentElement.clientWidth) || 0;
                const vpHeight = window.innerHeight || (typeof document !== "undefined" && document.documentElement && document.documentElement.clientHeight) || 0;
                if (vpWidth > 0 && vpHeight > 0) {
                    if (rect.bottom <= 0 || rect.right <= 0 || rect.top >= vpHeight || rect.left >= vpWidth) {
                        return false;
                    }
                }
            }
        }
    }

    return true;
}


// ------------------------------------------------------------
// POST-ACTION VERIFICATION HELPERS
// ------------------------------------------------------------

function captureVerificationState() {

    const state = {
    cartTexts: [],
    cartItemsText: "",
    alerts: [],
    visibleResults: []
    };

    if (typeof document === "undefined") {
        return state;
    }

    try {
        if (typeof document.querySelectorAll === "function") {
            const cartElements = document.querySelectorAll(
                "a[href*='cart'], a[href*='bag'], [class*='cart'], [id*='cart'], [aria-label*='cart'], [class*='bag'], [id*='bag']"
            );
            state.cartTexts = Array.from(cartElements)
                .map((el) => el.innerText?.trim() || (typeof el.getAttribute === "function" && el.getAttribute("aria-label")?.trim()) || "")
                .filter(Boolean);

            const cartContainers = document.querySelectorAll(
                "#cart, .cart, #cart-items, .cart-items, .cart-drawer, [data-cart], .bag-items, table.cart, #shopping-cart"
            );
            state.cartItemsText = Array.from(cartContainers)
                .map((el) => el.innerText?.trim() || "")
                .join(" ");

            const alertElements = document.querySelectorAll(
                ".alert, .toast, .notification, [role='alert'], [role='status'], .success, .message"
            );
            state.alerts = Array.from(alertElements)
                .map((el) => el.innerText?.trim() || "")
                .filter(Boolean);
            const resultElements = document.querySelectorAll(
                "[aria-live='polite'], [aria-live='assertive'], [role='status'], [role='alert'], section[id$='Result'], [id$='Result']"
            );

            state.visibleResults = Array.from(resultElements)
                .filter((el) => isElementVisible(el))
                .map((el) => ({
                    id: el.id || "",
                    text: (el.innerText || el.textContent || "").trim()
                }))
                .filter((result) => result.id || result.text);
        }
    } catch (_) {}

    return state;
}


function parseCartCount(text) {
    if (!text || typeof text !== "string") {
        return null;
    }

    const clean = text.trim();

    // Ignore currency or price values (e.g. $39, ₹78, €39.99, $39.00, 39 USD)
    if (/^[\$₹€£]\s*\d+|\d+\s*(?:usd|eur|inr|gbp)\b/i.test(clean)) {
        return null;
    }

    // Pattern 1: Cart (2), Bag (0), Items: 3, Cart: 1
    const cartMatch = clean.match(/(?:cart|bag|items?|qty|quantity)\s*[:(]?\s*(\d+)\s*\)?/i);
    if (cartMatch && cartMatch[1]) {
        return parseInt(cartMatch[1], 10);
    }

    // Pattern 2: Standalone bracketed number like "(2)" or badge digits "2"
    const standaloneMatch = clean.match(/^\(?(\d{1,4})\)?$/);
    if (standaloneMatch && standaloneMatch[1]) {
        return parseInt(standaloneMatch[1], 10);
    }

    return null;
}


function normalizeText(text) {
    return String(text || "")
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}


function isOnlyCartBadge(text) {
    if (!text || typeof text !== "string") return true;
    const stripped = text
        .toLowerCase()
        .replace(/(?:shopping\s*)?(?:cart|bag|items?|qty|quantity)/gi, "")
        .replace(/[\$₹€£\d.,:()\-+]/g, "")
        .trim();
    return stripped.length === 0;
}


function verifyActionOutcome(preState, postState, expectedProduct = "") {

    const cleanProduct = String(expectedProduct || "").trim().toLowerCase();
    const normalizedProduct = normalizeText(cleanProduct);

    // 1. Preferred proof: Confirm product specifically inside cart items / cart container
    if (normalizedProduct && postState?.cartItemsText && postState.cartItemsText.trim().length > 0) {
        const preHadProduct = normalizeText(preState?.cartItemsText || "").includes(normalizedProduct);
        const postHasProduct = normalizeText(postState.cartItemsText).includes(normalizedProduct);

        if (postHasProduct && !preHadProduct) {
            return {
                verified: true,
                detail: `'${expectedProduct}' confirmed in cart.`
            };
        }

        // If the cart items container actually displays item names (not just a badge/count),
        // and the requested product is not among them, reject verification.
        if (!isOnlyCartBadge(postState.cartItemsText) && !postHasProduct) {
            return {
                verified: false,
                detail: `Action executed, but '${expectedProduct}' was not confirmed in the cart.`
            };
        }
    }

    // 2. Preferred proof: Confirm product inside cart badge / link text or specific alert
    if (normalizedProduct) {
        if (Array.isArray(postState?.cartTexts)) {
            const matchingCartText = postState.cartTexts.find(
                t => normalizeText(t).includes(normalizedProduct)
            );
            if (matchingCartText) {
                return {
                    verified: true,
                    detail: `'${expectedProduct}' confirmed in cart: '${matchingCartText}'.`
                };
            }
        }

        const matchingAlert = (postState?.alerts || []).find(
            a => normalizeText(a).includes(normalizedProduct)
        );
        if (matchingAlert) {
            return {
                verified: true,
                detail: `Confirmation observed: '${matchingAlert}'.`
            };
        }
    }

    // 3. Reliable cart count increment verification:
    // A single product addition should produce a realistic count increment (1-3 items).
    // A number changing from 39 to 78 alone (delta = 39) is unreliable and does NOT count as proof.
    const preCounts = (preState?.cartTexts || []).map(parseCartCount).filter(n => n !== null);
    const postCounts = (postState?.cartTexts || []).map(parseCartCount).filter(n => n !== null);

    if (preCounts.length > 0 && postCounts.length > 0) {
        const preMax = Math.max(...preCounts);
        const postMax = Math.max(...postCounts);
        const delta = postMax - preMax;

        const isReliableIncrement = delta >= 1 && delta <= 3;

        if (isReliableIncrement) {
            const preCartJoined = (preState?.cartTexts || []).join(" | ");
            const postCartJoined = (postState?.cartTexts || []).join(" | ");

            if (cleanProduct) {
                return {
                    verified: true,
                    detail: `'${expectedProduct}' added: cart count updated from ${preMax} to ${postMax}.`
                };
            }
            if (preCartJoined && postCartJoined && preCartJoined !== postCartJoined) {
                return {
                    verified: true,
                    detail: `Cart updated from '${preCartJoined}' to '${postCartJoined}'.`
                };
            }
            return {
                verified: true,
                detail: `Cart count updated from ${preMax} to ${postMax}.`
            };
        }
    }

    // 4. Cart text change (for generic clicks when no specific product was requested)
    if (!cleanProduct) {
        const preCartJoined = (preState?.cartTexts || []).join(" | ");
        const postCartJoined = (postState?.cartTexts || []).join(" | ");

        if (preCartJoined !== postCartJoined && (postState?.cartTexts || []).length > 0) {
            return {
                verified: true,
                detail: `Cart updated from '${preCartJoined || "empty"}' to '${postCartJoined}'.`
            };
        }
    }

    // 5. New confirmation alert
    const newAlerts = (postState?.alerts || []).filter(
        (a) => !(preState?.alerts || []).includes(a)
    );
    if (newAlerts.length > 0) {
        return {
            verified: true,
            detail: `Confirmation message observed: '${newAlerts[0]}'.`
        };
    }

    // 6. If no cart elements exist on page at all, pure click on control succeeds
    const hasCartOnPage = (preState?.cartTexts || []).length > 0 || (postState?.cartTexts || []).length > 0 || Boolean(postState?.cartItemsText);
    if (!hasCartOnPage) {
        return {
            verified: true,
            detail: "Click executed successfully."
        };
    }

    // 7. Not confirmed in cart
    return {
        verified: false,
        detail: cleanProduct
            ? `Action executed, but '${expectedProduct}' was not confirmed in the cart.`
            : "Action executed, but no cart or confirmation change was observed."
    };
}


async function waitForCartConfirmation(expectedProduct, preState, timeoutMs = 1200) {

    const startTime = Date.now();
    const intervalMs = 100;

    // Check immediately (0ms delay)
    let currentState = captureVerificationState();
    let outcome = verifyActionOutcome(preState, currentState, expectedProduct);

    if (outcome.verified) {
        return outcome;
    }

    const timer = typeof setTimeout !== "undefined"
        ? setTimeout
        : (typeof window !== "undefined" && window.setTimeout)
            ? window.setTimeout.bind(window)
            : (typeof globalThis !== "undefined" && globalThis.setTimeout)
                ? globalThis.setTimeout.bind(globalThis)
                : null;

    if (!timer) {
        return outcome;
    }

    // Poll until timeoutMs allows website / asynchronous updates to complete
    while (Date.now() - startTime < timeoutMs) {
        await new Promise((resolve) => timer(resolve, intervalMs));

        currentState = captureVerificationState();
        outcome = verifyActionOutcome(preState, currentState, expectedProduct);

        if (outcome.verified) {
            return outcome;
        }
    }

    return outcome;
}


// ------------------------------------------------------------
// EXECUTE ACTION
// ------------------------------------------------------------

async function executeBrowserAction(action) {

    if (!action || !action.action) {
        return {
            success: false,
            verified: false,
            error: "Invalid action."
        };
    }


    switch (action.action) {

        case "click": {

            const element = getElement(action.selector);

            if (!element) {
                return {
                    success: false,
                    verified: false,
                    error: "Click target not found."
                };
            }

            if (
                element.disabled ||
                element.getAttribute?.("aria-disabled") === "true"
            ) {
                return {
                    success: false,
                    verified: false,
                    error: "Click target is disabled."
                };
            }

            if (!isElementVisible(element)) {
                return {
                    success: false,
                    verified: false,
                    error: "Click target is not visible or interactive."
                };
            }

            const targetLabel = String(
                element.innerText || element.getAttribute?.("aria-label") || ""
            ).trim();
            const isCartAction = Boolean(action.product) ||
                /\b(?:add|buy|purchase|put)\b.*\b(?:cart|bag|basket)\b/i.test(
                    `${action.target || ""} ${targetLabel}`
                );
            const expectedProduct = isCartAction
                ? (action.product || action.target || findProductTitle(element) || "")
                : "";

            console.info?.("PrivAgent executing browser action", {
                action: action.action,
                product: expectedProduct,
                selector: action.selector,
                tagName: element.tagName || "",
                label: String(element.innerText || element.getAttribute?.("aria-label") || "").trim(),
                href: element.getAttribute?.("href") || ""
            });

            const preState = captureVerificationState();

            element.click();

            // Cart verification is specific to cart actions. For other clicks,
            // preserve the ordinary-click contract: report dispatch success
            // without claiming the website effect was independently verified.
            if (!isCartAction) {
                return {
                    success: true,
                    action: "click",
                    verified: false,
                    verification: {
                        verified: false,
                        detail: "Click dispatched; website effect was not independently verified."
                    }
                };
            }

            const timeoutMs =
                typeof action.timeoutMs === "number" ? action.timeoutMs : 1200;

            const verification = await waitForCartConfirmation(
                expectedProduct,
                preState,
                timeoutMs
            );

            const postState = captureVerificationState();
            console.info?.("PrivAgent cart state after browser action", {
                product: expectedProduct,
                verification,
                cartTexts: postState.cartTexts,
                cartItemsText: postState.cartItemsText,
                alerts: postState.alerts
            });

            // Never report success unless the product is actually confirmed
            if (verification.verified) {
                return {
                    success: true,
                    action: "click",
                    verified: true,
                    product: expectedProduct,
                    verification: verification
                };
            } else {
                return {
                    success: false,
                    action: "click",
                    verified: false,
                    product: expectedProduct,
                    error: verification.detail,
                    verification: verification
                };
            }
        }


        case "type": {

            const element = getElement(action.selector);

            if (!element) {
                return {
                    success: false,
                    error: "Type target not found."
                };
            }

            element.focus();

            element.value = action.value || "";

            element.dispatchEvent(
                new Event("input", {
                    bubbles: true
                })
            );

            element.dispatchEvent(
                new Event("change", {
                    bubbles: true
                })
            );

            if (action.submit) {
                if (element.form && typeof element.form.requestSubmit === "function") {
                    try {
                        element.form.requestSubmit();
                    } catch (_) {
                        element.form.submit();
                    }
                } else if (element.form && typeof element.form.submit === "function") {
                    element.form.submit();
                } else if (typeof element.dispatchEvent === "function") {
                    element.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true }));
                    element.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true }));
                }
            }

            return {
                success: true,
                action: "type"
            };
        }


        case "scroll": {

            window.scrollBy({
                top: action.amount || 0,
                behavior: "smooth"
            });

            return {
                success: true,
                action: "scroll"
            };
        }


        case "wait": {

            return {
                success: true,
                action: "wait"
            };
        }


        case "noop": {

            return {
                success: true,
                action: "noop"
            };
        }


        default:

            return {
                success: false,
                error: `Unsupported action: ${action.action}`
            };
    }
}


// ------------------------------------------------------------
// MESSAGE LISTENER
// ------------------------------------------------------------

chrome.runtime.onMessage.addListener(
    (message, sender, sendResponse) => {

        if (!message || !message.type) {

            sendResponse({
                success: false,
                error: "Invalid message."
            });

            return;
        }


        // Return current page state
        if (message.type === "GET_PAGE_STATE") {

            sendResponse({
                success: true,
                pageState: getPageState()
            });

            return;
        }


        // Execute action approved by background/agent
        if (message.type === "EXECUTE_BROWSER_ACTION") {

            Promise.resolve(executeBrowserAction(message.action))
                .then((result) => {
                    sendResponse(result);
                })
                .catch((error) => {
                    sendResponse({
                        success: false,
                        verified: false,
                        error: error.message || "Browser action execution failed."
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


if (typeof module !== "undefined" && module.exports) {
    module.exports = {
        getPageState,
        findInteractiveElements,
        createSelector,
        getElement,
        isElementVisible,
        executeBrowserAction,
        captureVerificationState,
        verifyActionOutcome,
        waitForCartConfirmation,
        findProductTitle,
        isValidProductTitle,
        getContainerContext,
        isSensitiveEditableElement
    };
}
