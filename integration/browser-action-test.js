const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// Load extension/content.js in a controlled sandbox to test browser action execution
const contentCode = fs.readFileSync(
    path.join(__dirname, "../extension/content.js"),
    "utf8"
);

// Mock chrome API for background.js loading in Node
if (typeof global.chrome === "undefined") {
    global.chrome = {
        runtime: {
            onInstalled: { addListener: () => {} },
            onMessage: { addListener: () => {} }
        },
        tabs: {
            query: () => {},
            get: () => {},
            sendMessage: () => {},
            update: () => {}
        }
    };
}

const { resolveUnambiguousCandidates, applyCandidateResolution } = require("../extension/background.js");

function createMockEnvironment(options = {}) {
    let mockElementMap = options.elements || {};
    let mockQuerySelectorAll = options.querySelectorAll || (() => []);

    const sandbox = {
        console: {
            log: () => {},
            error: () => {},
            warn: () => {}
        },
        document: {
            title: options.title || "Mock Test Page",
            querySelector: (selector) => {
                if (typeof mockElementMap === "function") {
                    return mockElementMap(selector);
                }
                return mockElementMap[selector] || null;
            },
            querySelectorAll: (selector) => {
                if (typeof mockQuerySelectorAll === "function") {
                    return mockQuerySelectorAll(selector);
                }
                return mockQuerySelectorAll[selector] || [];
            }
        },
        window: {
            location: { href: "http://127.0.0.1:8001/test" },
            getComputedStyle: (element) => element?.style || {
                display: "block",
                visibility: "visible",
                opacity: "1",
                pointerEvents: "auto"
            },
            scrollBy: () => {}
        },
        chrome: {
            runtime: {
                onMessage: {
                    addListener: () => {}
                }
            }
        },
        setTimeout: setTimeout,
        clearTimeout: clearTimeout,
        Date: Date,
        Event: global.Event || class Event { constructor(type, opts) { this.type = type; this.bubbles = opts?.bubbles; } },
        KeyboardEvent: global.KeyboardEvent || class KeyboardEvent { constructor(type, opts) { this.type = type; this.key = opts?.key; } },
        PrivAgentPrivacy: {
            sanitizePageState: (state) => state
        }
    };

    vm.createContext(sandbox);
    vm.runInContext(contentCode, sandbox);

    return {
        sandbox,
        setElements: (map) => {
            mockElementMap = map;
        },
        setQuerySelectorAll: (fn) => {
            mockQuerySelectorAll = fn;
        }
    };
}

const tests = [
    ["Keeps unique browser candidate despite conflicting server navigation", () => {
        const result = applyCandidateResolution(
            { action: "navigate", url: "https://example.test/guide" },
            { candidates: [{ action: "click", selector: "[data-privagent-id=\"pa-cartbtn99\"]", product: "Cypress Checkout Suite" }], isAmbiguous: false }
        );
        assert.equal(result.action, "click");
        assert.equal(result.selector, "[data-privagent-id=\"pa-cartbtn99\"]");
        assert.equal(result.product, "Cypress Checkout Suite");
        assert.equal(result.url, null);
    }],
    ["Blocks fallback action when requested target is ambiguous", () => {
        const result = applyCandidateResolution(
            { action: "click", selector: "[data-privagent-id=\"wrong\"]" },
            { candidates: [], isAmbiguous: true }
        );
        assert.equal(result.action, "noop");
        assert.equal(result.selector, undefined);
        assert.equal(result.requires_confirmation, false);
    }],
    [
        "Refuses duplicate Donate and Log in targets while resolving a unique English link",
        () => {
            const donate = resolveUnambiguousCandidates("click Donate", [
                { type: "a", role: "link", label: "Donate", selector: "#donate-header", enabled: true, visible: true },
                { type: "a", role: "link", label: "Donate", selector: "#donate-footer", enabled: true, visible: true }
            ]);
            const login = resolveUnambiguousCandidates("click Log in", [
                { type: "a", role: "link", label: "Log in", selector: "#login-header", enabled: true, visible: true },
                { type: "a", role: "link", label: "Log in", selector: "#login-menu", enabled: true, visible: true }
            ]);
            const mixedRoleLogin = [
                { type: "button", role: "button", label: "Log in", selector: "#login-button", enabled: true, visible: true },
                { type: "a", role: "link", label: "Log in", selector: "#login-link", enabled: true, visible: true }
            ];
            const mixedRoleAmbiguous = resolveUnambiguousCandidates("click Log in", mixedRoleLogin);
            const explicitLoginLink = resolveUnambiguousCandidates("click Log in link", mixedRoleLogin);
            const english = resolveUnambiguousCandidates("click English Wikipedia link", [
                { type: "a", role: "link", label: "English", selector: "#english", enabled: true, visible: true }
            ]);

            assert.equal(donate.isAmbiguous, true);
            assert.equal(donate.candidates.length, 0);
            assert.equal(login.isAmbiguous, true);
            assert.equal(login.candidates.length, 0);
            assert.equal(mixedRoleAmbiguous.isAmbiguous, true);
            assert.equal(mixedRoleAmbiguous.candidates.length, 0);
            assert.equal(explicitLoginLink.isAmbiguous, false);
            assert.equal(explicitLoginLink.candidates[0].selector, "#login-link");
            assert.equal(english.isAmbiguous, false);
            assert.equal(english.candidates[0].selector, "#english");
        }
    ],
    [
        "Resolves 'click view history' while ignoring unrelated links containing 'view'",
        () => {
            const controls = [
                { type: "a", role: "link", label: "View source", selector: "#ca-viewsource", enabled: true, visible: true },
                { type: "a", role: "link", label: "View", selector: "#unrelated-view", enabled: true, visible: true },
                { type: "a", role: "link", label: "Quick view", selector: "#quick-view", enabled: true, visible: true },
                { type: "a", role: "link", label: "View history", selector: "#ca-history", enabled: true, visible: true }
            ];

            const resolution = resolveUnambiguousCandidates("click view history", controls);
            assert.equal(resolution.isAmbiguous, false, "Should not be ambiguous when an exact 'View history' link exists");
            assert.equal(resolution.candidates.length, 1);
            assert.equal(resolution.candidates[0].selector, "#ca-history");
            assert.equal(resolution.candidates[0].product, null, "Non-cart command must not have a product assigned");

            // Candidate handoff to backend simulation
            const backendAction = applyCandidateResolution(
                { action: "click", selector: "#default" },
                resolution
            );
            assert.equal(backendAction.action, "click");
            assert.equal(backendAction.selector, "#ca-history");
            assert.equal(backendAction.product, null);
        }
    ],
    [
        "Unrelated links containing 'view' alone do not trigger false ambiguity when target is missing",
        () => {
            const controls = [
                { type: "a", role: "link", label: "View source", selector: "#ca-viewsource", enabled: true, visible: true },
                { type: "a", role: "link", label: "View details", selector: "#ca-details", enabled: true, visible: true }
            ];

            const resolution = resolveUnambiguousCandidates("click view history", controls);
            assert.equal(resolution.candidates.length, 0);
            assert.equal(resolution.isAmbiguous, false, "Action verb 'view' must not create false ambiguity between unrelated links");
        }
    ],
    [
        "Preserves safe refusal when multiple genuinely duplicate 'View history' links exist",
        () => {
            const controls = [
                { type: "a", role: "link", label: "View history", selector: "#ca-history-header", enabled: true, visible: true },
                { type: "a", role: "link", label: "View history", selector: "#ca-history-footer", enabled: true, visible: true }
            ];

            const resolution = resolveUnambiguousCandidates("click view history", controls);
            assert.equal(resolution.isAmbiguous, true, "Must flag ambiguity when multiple identical 'View history' links exist");
            assert.equal(resolution.candidates.length, 0);

            const finalAction = applyCandidateResolution(
                { action: "click", selector: "#ca-history-header" },
                resolution
            );
            assert.equal(finalAction.action, "noop", "Ambiguous resolution must safely override action to noop");
        }
    ],
    [
        "Content script extracts visible 'View history' link text instead of tooltip title attribute",
        () => {
            const mockHistoryAnchor = {
                tagName: "A",
                innerText: "View history",
                getAttribute: (attr) => attr === "title" ? "Past revisions of this page [h]" : (attr === "href" ? "/w/index.php?title=Test&action=history" : null),
                hasAttribute: (attr) => attr === "href" || attr === "title",
                isConnected: true,
                getBoundingClientRect: () => ({ width: 80, height: 24, top: 100, left: 100, right: 180, bottom: 124 }),
                getClientRects: () => [{ width: 80, height: 24 }],
                parentElement: null
            };

            const { sandbox } = createMockEnvironment({
                querySelectorAll: (sel) => {
                    if (sel.includes("a")) return [mockHistoryAnchor];
                    return [];
                }
            });

            const controls = sandbox.findInteractiveElements();
            assert.equal(controls.length, 1);
            assert.equal(controls[0].label, "View history", "Visible link innerText must take precedence over title tooltip");
            assert.equal(controls[0].visible, true);
            assert.equal(controls[0].enabled, true);
        }
    ],
    [
        "Rejects click action when target element is not found",
        async () => {
            const { sandbox } = createMockEnvironment();
            const result = await sandbox.executeBrowserAction({
                action: "click",
                selector: "#missing-button"
            });

            assert.equal(result.success, false);
            assert.equal(result.error, "Click target not found.");
        }
    ],
    [
        "Rejects click action when target element is disabled",
        async () => {
            const { sandbox, setElements } = createMockEnvironment();
            let clicked = false;

            setElements({
                "#disabled-button": {
                    disabled: true,
                    isConnected: true,
                    getBoundingClientRect: () => ({ width: 100, height: 40 }),
                    getClientRects: () => [{ width: 100, height: 40 }],
                    click: () => {
                        clicked = true;
                    }
                }
            });

            const result = await sandbox.executeBrowserAction({
                action: "click",
                selector: "#disabled-button"
            });

            assert.equal(result.success, false);
            assert.equal(result.error, "Click target is disabled.");
            assert.equal(clicked, false);
        }
    ],
    [
        "Rejects click action when target has aria-disabled='true'",
        async () => {
            const { sandbox, setElements } = createMockEnvironment();
            let clicked = false;

            setElements({
                "#aria-disabled-btn": {
                    disabled: false,
                    isConnected: true,
                    getAttribute: (attr) => (attr === "aria-disabled" ? "true" : null),
                    getBoundingClientRect: () => ({ width: 100, height: 40 }),
                    getClientRects: () => [{ width: 100, height: 40 }],
                    click: () => {
                        clicked = true;
                    }
                }
            });

            const result = await sandbox.executeBrowserAction({
                action: "click",
                selector: "#aria-disabled-btn"
            });

            assert.equal(result.success, false);
            assert.equal(result.error, "Click target is disabled.");
            assert.equal(clicked, false);
        }
    ],
    [
        "Rejects click action when target is hidden (display: none)",
        async () => {
            const { sandbox, setElements } = createMockEnvironment();
            let clicked = false;

            setElements({
                "#hidden-button": {
                    disabled: false,
                    isConnected: true,
                    style: {
                        display: "none",
                        visibility: "visible",
                        opacity: "1",
                        pointerEvents: "auto"
                    },
                    getBoundingClientRect: () => ({ width: 0, height: 0 }),
                    getClientRects: () => [],
                    click: () => {
                        clicked = true;
                    }
                }
            });

            const result = await sandbox.executeBrowserAction({
                action: "click",
                selector: "#hidden-button"
            });

            assert.equal(result.success, false);
            assert.equal(result.error, "Click target is not visible or interactive.");
            assert.equal(clicked, false);
        }
    ],
    [
        "Rejects click action when target has pointer-events: none",
        async () => {
            const { sandbox, setElements } = createMockEnvironment();
            let clicked = false;

            setElements({
                "#no-pointer-btn": {
                    disabled: false,
                    isConnected: true,
                    style: {
                        display: "block",
                        visibility: "visible",
                        opacity: "1",
                        pointerEvents: "none"
                    },
                    getBoundingClientRect: () => ({ width: 100, height: 40 }),
                    getClientRects: () => [{ width: 100, height: 40 }],
                    click: () => {
                        clicked = true;
                    }
                }
            });

            const result = await sandbox.executeBrowserAction({
                action: "click",
                selector: "#no-pointer-btn"
            });

            assert.equal(result.success, false);
            assert.equal(result.error, "Click target is not visible or interactive.");
            assert.equal(clicked, false);
        }
    ],
    [
        "Executes click when target is valid, enabled, and visible",
        async () => {
            const { sandbox, setElements } = createMockEnvironment();
            let clicked = false;

            setElements({
                "#valid-button": {
                    disabled: false,
                    isConnected: true,
                    style: {
                        display: "block",
                        visibility: "visible",
                        opacity: "1",
                        pointerEvents: "auto"
                    },
                    getBoundingClientRect: () => ({ width: 120, height: 40 }),
                    getClientRects: () => [{ width: 120, height: 40 }],
                    click: () => {
                        clicked = true;
                    }
                }
            });

            const result = await sandbox.executeBrowserAction({
                action: "click",
                selector: "#valid-button"
            });

            assert.equal(result.success, true);
            assert.equal(result.action, "click");
            assert.equal(clicked, true);
        }
    ],
    [
        "Reports ordinary clicks as dispatched without applying cart-only verification",
        async () => {
            const { sandbox, setElements } = createMockEnvironment();
            let clicked = false;
            setElements({
                "#ordinary-link": {
                    tagName: "A",
                    innerText: "Read",
                    disabled: false,
                    isConnected: true,
                    style: {
                        display: "block",
                        visibility: "visible",
                        opacity: "1",
                        pointerEvents: "auto"
                    },
                    getAttribute: (name) => name === "href" ? "/wiki/Example" : null,
                    getBoundingClientRect: () => ({ width: 80, height: 24 }),
                    getClientRects: () => [{ width: 80, height: 24 }],
                    click: () => { clicked = true; }
                }
            });

            const result = await sandbox.executeBrowserAction({
                action: "click",
                selector: "#ordinary-link"
            });

            assert.equal(clicked, true);
            assert.equal(result.success, true);
            assert.equal(result.verified, false);
            assert.match(result.verification.detail, /Click dispatched/);
        }
    ],
    [
        "Handles noop action without interacting with DOM",
        async () => {
            const { sandbox } = createMockEnvironment();
            const result = await sandbox.executeBrowserAction({
                action: "noop"
            });

            assert.equal(result.success, true);
            assert.equal(result.action, "noop");
        }
    ],
    [
        "Enriches product button labels with associated product name from container",
        () => {
            const card1 = {
                tagName: "DIV",
                classList: { contains: (c) => c === "card" },
                querySelectorAll: () => [],
                querySelector: (sel) => (sel.includes("title") ? { innerText: "Tailored Wool Coat" } : null)
            };
            const btn1 = {
                tagName: "BUTTON",
                type: "button",
                innerText: "Add to Bag",
                dataset: {},
                parentElement: card1,
                getAttribute: () => null
            };

            const card2 = {
                tagName: "DIV",
                classList: { contains: (c) => c === "card" },
                querySelectorAll: () => [],
                querySelector: (sel) => (sel.includes("title") ? { innerText: "Selenium Login Test Pack" } : null)
            };
            const btn2 = {
                tagName: "BUTTON",
                type: "button",
                innerText: "Add to Cart",
                dataset: {},
                parentElement: card2,
                getAttribute: () => null
            };

            const card3 = {
                tagName: "DIV",
                classList: { contains: (c) => c === "card" },
                querySelectorAll: () => [],
                querySelector: (sel) => (sel.includes("title") ? { innerText: "Chelsea Leather Boots" } : null)
            };
            const btn3 = {
                tagName: "BUTTON",
                type: "button",
                innerText: "Add to Bag",
                dataset: {},
                parentElement: card3,
                getAttribute: () => null
            };

            const { sandbox } = createMockEnvironment({
                querySelectorAll: () => [btn1, btn2, btn3]
            });

            const elements = sandbox.findInteractiveElements();
            assert.equal(elements.length, 3);
            assert.equal(elements[0].label, "Add to Bag - Tailored Wool Coat");
            assert.equal(elements[1].label, "Add to Cart - Selenium Login Test Pack");
            assert.equal(elements[2].label, "Add to Bag - Chelsea Leather Boots");
        }
    ],
    [
        "Resolves unambiguous candidate for specific product and prevents picking wrong product",
        () => {
            const controls = [
                {
                    type: "button",
                    label: "Add to Bag - Tailored Wool Coat",
                    selector: "[data-privagent-id='pa-wool']",
                    enabled: true
                },
                {
                    type: "button",
                    label: "Add to Cart - Selenium Login Test Pack",
                    selector: "[data-privagent-id='pa-selenium']",
                    enabled: true
                },
                {
                    type: "button",
                    label: "Add to Bag - Chelsea Leather Boots",
                    selector: "[data-privagent-id='pa-boots']",
                    enabled: true
                }
            ];

            const result = resolveUnambiguousCandidates(
                "Add Selenium Login Test Pack to the cart",
                controls
            );

            assert.equal(result.isAmbiguous, false);
            assert.equal(result.candidates.length, 1);
            assert.equal(result.candidates[0].action, "click");
            assert.equal(result.candidates[0].selector, "[data-privagent-id='pa-selenium']");
        }
    ],
    [
        "Prevents automatic fallback when target is ambiguous across multiple products",
        () => {
            const controls = [
                {
                    type: "button",
                    label: "Add to Bag - Tailored Wool Coat",
                    selector: "[data-privagent-id='pa-wool']",
                    enabled: true
                },
                {
                    type: "button",
                    label: "Add to Cart - Selenium Login Test Pack",
                    selector: "[data-privagent-id='pa-selenium']",
                    enabled: true
                },
                {
                    type: "button",
                    label: "Add to Bag - Chelsea Leather Boots",
                    selector: "[data-privagent-id='pa-boots']",
                    enabled: true
                }
            ];

            const genericResult = resolveUnambiguousCandidates(
                "Add to cart",
                controls
            );

            assert.equal(genericResult.isAmbiguous, true);
            assert.equal(genericResult.candidates.length, 0);

            const multiControls = [
                {
                    type: "button",
                    label: "Add to Cart - Starter Test Pack",
                    selector: "[data-privagent-id='pa-starter']",
                    enabled: true
                },
                {
                    type: "button",
                    label: "Add to Cart - Pro Test Pack",
                    selector: "[data-privagent-id='pa-pro']",
                    enabled: true
                }
            ];

            const ambiguousPack = resolveUnambiguousCandidates(
                "Add Test Pack to cart",
                multiControls
            );

            assert.equal(ambiguousPack.isAmbiguous, true);
            assert.equal(ambiguousPack.candidates.length, 0);
        }
    ],
    [
        "Verifies action outcome when click causes cart state to update",
        async () => {
            const cartElement = {
                innerText: "Cart (2)",
                getAttribute: () => null
            };

            let clicked = false;
            const targetButton = {
                disabled: false,
                isConnected: true,
                style: {
                    display: "block",
                    visibility: "visible",
                    opacity: "1",
                    pointerEvents: "auto"
                },
                getBoundingClientRect: () => ({ width: 100, height: 40 }),
                getClientRects: () => [{ width: 100, height: 40 }],
                click: () => {
                    clicked = true;
                    cartElement.innerText = "Cart (3)";
                }
            };

            const { sandbox } = createMockEnvironment({
                elements: {
                    "#add-btn": targetButton
                },
                querySelectorAll: (sel) => {
                    if (sel && (sel.includes("cart") || sel.includes("bag"))) {
                        return [cartElement];
                    }
                    return [];
                }
            });

            const result = await sandbox.executeBrowserAction({
                action: "click",
                selector: "#add-btn",
                product: "Sample product",
                timeoutMs: 200
            });

            assert.equal(result.success, true);
            assert.equal(clicked, true);
            assert.equal(result.verified, true);
            assert.equal(
                result.verification.detail,
                "'Sample product' added: cart count updated from 2 to 3."
            );
        }
    ],
    [
        "Never reports success when click does not produce expected cart state change",
        async () => {
            const cartElement = {
                innerText: "Cart (2)",
                getAttribute: () => null
            };

            let clicked = false;
            const targetButton = {
                disabled: false,
                isConnected: true,
                style: {
                    display: "block",
                    visibility: "visible",
                    opacity: "1",
                    pointerEvents: "auto"
                },
                getBoundingClientRect: () => ({ width: 100, height: 40 }),
                getClientRects: () => [{ width: 100, height: 40 }],
                click: () => {
                    clicked = true;
                }
            };

            const { sandbox } = createMockEnvironment({
                elements: {
                    "#silent-btn": targetButton
                },
                querySelectorAll: (sel) => {
                    if (sel && (sel.includes("cart") || sel.includes("bag"))) {
                        return [cartElement];
                    }
                    return [];
                }
            });

            const result = await sandbox.executeBrowserAction({
                action: "click",
                selector: "#silent-btn",
                product: "Expected product",
                timeoutMs: 150
            });

            assert.equal(result.success, false);
            assert.equal(clicked, true);
            assert.equal(result.verified, false);
            assert.equal(
                result.error,
                "Action executed, but 'Expected product' was not confirmed in the cart."
            );
        }
    ],
    [
        "Correctly matches each button to its own product in a section without title mixing",
        () => {
            const section = {
                tagName: "SECTION",
                classList: { contains: () => false },
                querySelectorAll: () => [btn1, btn2]
            };

            const prod1 = {
                tagName: "DIV",
                classList: { contains: (c) => c === "product" },
                parentElement: section,
                querySelectorAll: (sel) => {
                    if (sel.includes("card") || sel.includes("product")) return [prod1];
                    if (sel.includes("h1") || sel.includes("h2") || sel.includes("h3") || sel.includes("h4") || sel.includes("title")) {
                        return [{ innerText: "Selenium Login Test Pack" }];
                    }
                    return [];
                },
                querySelector: (sel) => {
                    if (sel.includes("title") || sel.includes("h3") || sel.includes("h4")) {
                        return { innerText: "Selenium Login Test Pack" };
                    }
                    return null;
                }
            };

            const btn1 = {
                tagName: "BUTTON",
                type: "button",
                innerText: "Add to Cart",
                parentElement: prod1,
                dataset: {},
                getAttribute: () => null
            };

            const prod2 = {
                tagName: "DIV",
                classList: { contains: (c) => c === "product" },
                parentElement: section,
                querySelectorAll: (sel) => {
                    if (sel.includes("card") || sel.includes("product")) return [prod2];
                    if (sel.includes("h1") || sel.includes("h2") || sel.includes("h3") || sel.includes("h4") || sel.includes("title")) {
                        return [{ innerText: "Cypress Checkout Suite" }];
                    }
                    return [];
                },
                querySelector: (sel) => {
                    if (sel.includes("title") || sel.includes("h3") || sel.includes("h4")) {
                        return { innerText: "Cypress Checkout Suite" };
                    }
                    return null;
                }
            };

            const btn2 = {
                tagName: "BUTTON",
                type: "button",
                innerText: "Add to Cart",
                parentElement: prod2,
                dataset: {},
                getAttribute: () => null
            };

            const { sandbox } = createMockEnvironment({
                querySelectorAll: () => [btn1, btn2]
            });

            const elements = sandbox.findInteractiveElements();
            assert.equal(elements.length, 2);
            assert.equal(elements[0].label, "Add to Cart - Selenium Login Test Pack");
            assert.equal(elements[1].label, "Add to Cart - Cypress Checkout Suite");

            const candidateResult = resolveUnambiguousCandidates(
                "Add Cypress Checkout Suite to the cart",
                elements
            );
            assert.equal(candidateResult.isAmbiguous, false);
            assert.equal(candidateResult.candidates.length, 1);
            assert.equal(candidateResult.candidates[0].selector, elements[1].selector);
            assert.notEqual(candidateResult.candidates[0].selector, elements[0].selector);
        }
    ],
    [
        "Verifies action outcome when cart update is delayed by asynchronous operation",
        async () => {
            const cartElement = {
                innerText: "Cart (1)",
                getAttribute: () => null
            };

            let clicked = false;
            const targetButton = {
                disabled: false,
                isConnected: true,
                style: {
                    display: "block",
                    visibility: "visible",
                    opacity: "1",
                    pointerEvents: "auto"
                },
                getBoundingClientRect: () => ({ width: 100, height: 40 }),
                getClientRects: () => [{ width: 100, height: 40 }],
                click: () => {
                    clicked = true;
                    // Simulate delayed cart update
                    setTimeout(() => {
                        cartElement.innerText = "Cart (2)";
                    }, 120);
                }
            };

            const { sandbox } = createMockEnvironment({
                elements: {
                    "#cypress-btn": targetButton
                },
                querySelectorAll: (sel) => {
                    if (sel && (sel.includes("cart") || sel.includes("bag"))) {
                        return [cartElement];
                    }
                    return [];
                }
            });

            const result = await sandbox.executeBrowserAction({
                action: "click",
                selector: "#cypress-btn",
                product: "Cypress Checkout Suite",
                timeoutMs: 800
            });

            assert.equal(result.success, true);
            assert.equal(clicked, true);
            assert.equal(result.verified, true);
            assert.equal(
                result.verification.detail,
                "'Cypress Checkout Suite' added: cart count updated from 1 to 2."
            );
        }
    ],
    [
        "Never reports success when requested product is not confirmed in the cart",
        async () => {
            const cartElement = {
                innerText: "Cart (1)",
                getAttribute: () => null
            };

            let clicked = false;
            const targetButton = {
                disabled: false,
                isConnected: true,
                style: {
                    display: "block",
                    visibility: "visible",
                    opacity: "1",
                    pointerEvents: "auto"
                },
                getBoundingClientRect: () => ({ width: 100, height: 40 }),
                getClientRects: () => [{ width: 100, height: 40 }],
                click: () => {
                    clicked = true;
                }
            };

            const { sandbox } = createMockEnvironment({
                elements: {
                    "#fail-btn": targetButton
                },
                querySelectorAll: (sel) => {
                    if (sel && (sel.includes("cart") || sel.includes("bag"))) {
                        return [cartElement];
                    }
                    return [];
                }
            });

            const result = await sandbox.executeBrowserAction({
                action: "click",
                selector: "#fail-btn",
                product: "Cypress Checkout Suite",
                timeoutMs: 150
            });

            assert.equal(result.success, false);
            assert.equal(clicked, true);
            assert.equal(result.verified, false);
            assert.equal(
                result.error,
                "Action executed, but 'Cypress Checkout Suite' was not confirmed in the cart."
            );
        }
    ],
    [
        "Prioritizes action button over product title anchor link for Cypress Checkout Suite",
        () => {
            const card = {
                tagName: "DIV",
                classList: { contains: (c) => c === "card" || c === "product" },
                querySelectorAll: () => [],
                querySelector: (sel) => {
                    if (sel.includes("title") || sel.includes("a")) {
                        return { innerText: "Cypress Checkout Suite" };
                    }
                    return null;
                }
            };

            const titleAnchor = {
                tagName: "A",
                type: "",
                innerText: "Cypress Checkout Suite",
                parentElement: card,
                dataset: { privagentId: "pa-uh5vikxw" },
                getAttribute: () => null
            };

            const cartButton = {
                tagName: "BUTTON",
                type: "button",
                innerText: "Add to Cart",
                parentElement: card,
                dataset: { privagentId: "pa-cartbtn99" },
                getAttribute: () => null
            };

            const { sandbox } = createMockEnvironment({
                querySelectorAll: () => [titleAnchor, cartButton]
            });

            const elements = sandbox.findInteractiveElements();
            assert.equal(elements.length, 2);
            assert.equal(elements[0].selector, "[data-privagent-id=\"pa-uh5vikxw\"]");
            assert.equal(elements[0].type, "a");
            assert.equal(elements[0].label, "Cypress Checkout Suite");

            assert.equal(elements[1].selector, "[data-privagent-id=\"pa-cartbtn99\"]");
            assert.equal(elements[1].type, "button");
            assert.equal(elements[1].label, "Add to Cart - Cypress Checkout Suite");

            const candidateResult = resolveUnambiguousCandidates(
                "Add Cypress Checkout Suite to the cart",
                elements
            );

            assert.equal(candidateResult.isAmbiguous, false);
            assert.equal(candidateResult.candidates.length, 1);
            // Must strictly select the button, NOT the anchor link pa-uh5vikxw
            assert.equal(
                candidateResult.candidates[0].selector,
                "[data-privagent-id=\"pa-cartbtn99\"]"
            );
            assert.notEqual(
                candidateResult.candidates[0].selector,
                "[data-privagent-id=\"pa-uh5vikxw\"]"
            );
        }
    ],
    [
        "Reports action unconfirmed when anchor tag [data-privagent-id='pa-uh5vikxw'] is clicked without cart update",
        async () => {
            const cartElement = {
                innerText: "Cart (0)",
                getAttribute: () => null
            };

            let titleLinkClicked = false;
            const titleLink = {
                disabled: false,
                isConnected: true,
                style: {
                    display: "block",
                    visibility: "visible",
                    opacity: "1",
                    pointerEvents: "auto"
                },
                getBoundingClientRect: () => ({ width: 100, height: 20 }),
                getClientRects: () => [{ width: 100, height: 20 }],
                click: () => {
                    titleLinkClicked = true;
                    // Clicking the product title link does NOT change the cart!
                }
            };

            const { sandbox } = createMockEnvironment({
                elements: {
                    "[data-privagent-id='pa-uh5vikxw']": titleLink
                },
                querySelectorAll: (sel) => {
                    if (sel && (sel.includes("cart") || sel.includes("bag"))) {
                        return [cartElement];
                    }
                    return [];
                }
            });

            const result = await sandbox.executeBrowserAction({
                action: "click",
                selector: "[data-privagent-id='pa-uh5vikxw']",
                product: "Cypress Checkout Suite",
                timeoutMs: 150
            });

            assert.equal(result.success, false);
            assert.equal(titleLinkClicked, true);
            assert.equal(result.verified, false);
            assert.equal(
                result.error,
                "Action executed, but 'Cypress Checkout Suite' was not confirmed in the cart."
            );
        }
    ],
    [
        "Postman API Collection: selects Add to Cart button instead of product-title link",
        () => {
            const card = {
                tagName: "DIV",
                classList: { contains: (c) => c === "card" || c === "product" },
                querySelectorAll: () => [],
                querySelector: (sel) => (sel.includes("title") || sel.includes("a") ? { innerText: "Postman API Collection" } : null)
            };

            const titleLink = {
                tagName: "A",
                type: "",
                innerText: "Postman API Collection",
                parentElement: card,
                dataset: { privagentId: "pa-postman-link" },
                getAttribute: () => null
            };

            const cartBtn = {
                tagName: "BUTTON",
                type: "button",
                innerText: "Add to Cart",
                parentElement: card,
                dataset: { privagentId: "pa-postman-btn" },
                getAttribute: () => null
            };

            const { sandbox } = createMockEnvironment({
                querySelectorAll: () => [titleLink, cartBtn]
            });

            const elements = sandbox.findInteractiveElements();
            assert.equal(elements[0].selector, "[data-privagent-id=\"pa-postman-link\"]");
            assert.equal(elements[1].selector, "[data-privagent-id=\"pa-postman-btn\"]");

            const result = resolveUnambiguousCandidates(
                "Add Postman API Collection to the cart",
                elements
            );

            assert.equal(result.isAmbiguous, false);
            assert.equal(result.candidates.length, 1);
            assert.equal(result.candidates[0].selector, "[data-privagent-id=\"pa-postman-btn\"]");
            assert.notEqual(result.candidates[0].selector, "[data-privagent-id=\"pa-postman-link\"]");
        }
    ],
    [
        "Postman API Collection: stops safely when Add to Cart button is missing",
        () => {
            const card = {
                tagName: "DIV",
                classList: { contains: (c) => c === "card" || c === "product" },
                querySelectorAll: () => [],
                querySelector: (sel) => (sel.includes("title") || sel.includes("a") ? { innerText: "Postman API Collection" } : null)
            };

            const titleLink = {
                tagName: "A",
                type: "",
                innerText: "Postman API Collection",
                parentElement: card,
                dataset: { privagentId: "pa-postman-link" },
                getAttribute: () => null
            };

            const { sandbox } = createMockEnvironment({
                querySelectorAll: () => [titleLink] // Only title link, button is missing!
            });

            const elements = sandbox.findInteractiveElements();
            const result = resolveUnambiguousCandidates(
                "Add Postman API Collection to the cart",
                elements
            );

            assert.equal(result.candidates.length, 0);
            assert.equal(result.notFound, true);

            // applyCandidateResolution must stop safely with noop (does not guess or click title link)
            const resolvedAction = applyCandidateResolution({ action: "click", selector: "#guessed" }, result);
            assert.equal(resolvedAction.action, "noop");
        }
    ],
    [
        "Playwright API UI Bundle: selects Add to Cart button instead of product-title link",
        () => {
            const card = {
                tagName: "DIV",
                classList: { contains: (c) => c === "card" || c === "product" },
                querySelectorAll: () => [],
                querySelector: (sel) => (sel.includes("title") || sel.includes("a") ? { innerText: "Playwright API UI Bundle" } : null)
            };

            const titleLink = {
                tagName: "A",
                type: "",
                innerText: "Playwright API UI Bundle",
                parentElement: card,
                dataset: { privagentId: "pa-playwright-link" },
                getAttribute: () => null
            };

            const cartBtn = {
                tagName: "BUTTON",
                type: "button",
                innerText: "Add to Cart",
                parentElement: card,
                dataset: { privagentId: "pa-playwright-btn" },
                getAttribute: () => null
            };

            const { sandbox } = createMockEnvironment({
                querySelectorAll: () => [titleLink, cartBtn]
            });

            const elements = sandbox.findInteractiveElements();
            const result = resolveUnambiguousCandidates(
                "Add Playwright API UI Bundle to the cart",
                elements
            );

            assert.equal(result.isAmbiguous, false);
            assert.equal(result.candidates.length, 1);
            assert.equal(result.candidates[0].selector, "[data-privagent-id=\"pa-playwright-btn\"]");
            assert.notEqual(result.candidates[0].selector, "[data-privagent-id=\"pa-playwright-link\"]");
        }
    ],
    [
        "Playwright API UI Bundle: stops safely when button is missing and does not open another tab or guess target",
        () => {
            const card = {
                tagName: "DIV",
                classList: { contains: () => true },
                querySelectorAll: () => [],
                querySelector: (sel) => ({ innerText: "Playwright API UI Bundle" })
            };

            const titleLink = {
                tagName: "A",
                type: "",
                innerText: "Playwright API UI Bundle",
                parentElement: card,
                dataset: { privagentId: "pa-pw-link" },
                getAttribute: () => null
            };

            const otherProductBtn = {
                tagName: "BUTTON",
                type: "button",
                innerText: "Add to Cart - Selenium Login Test Pack",
                dataset: { privagentId: "pa-selenium-btn" },
                getAttribute: () => null
            };

            const { sandbox } = createMockEnvironment({
                querySelectorAll: () => [titleLink, otherProductBtn]
            });

            const elements = sandbox.findInteractiveElements();
            const result = resolveUnambiguousCandidates(
                "Add Playwright API UI Bundle to the cart",
                elements
            );

            assert.equal(result.candidates.length, 0);
            assert.equal(result.notFound, true);

            // Server candidate fallback or guessing must be neutralized to noop
            const action = applyCandidateResolution(
                { action: "navigate", url: "https://example.com/checkout" },
                result
            );
            assert.equal(action.action, "noop");
        }
    ],
    [
        "QA Test Case Template: selects Add to Cart button instead of product-title link",
        () => {
            const card = {
                tagName: "DIV",
                classList: { contains: (c) => c === "card" || c === "product" },
                querySelectorAll: () => [],
                querySelector: (sel) => (sel.includes("title") || sel.includes("a") ? { innerText: "QA Test Case Template" } : null)
            };

            const titleLink = {
                tagName: "A",
                type: "",
                innerText: "QA Test Case Template",
                parentElement: card,
                dataset: { privagentId: "pa-qa-link" },
                getAttribute: () => null
            };

            const cartBtn = {
                tagName: "BUTTON",
                type: "button",
                innerText: "Add to Cart",
                parentElement: card,
                dataset: { privagentId: "pa-qa-btn" },
                getAttribute: () => null
            };

            const { sandbox } = createMockEnvironment({
                querySelectorAll: () => [titleLink, cartBtn]
            });

            const elements = sandbox.findInteractiveElements();
            const result = resolveUnambiguousCandidates(
                "Add QA Test Case Template to the cart",
                elements
            );

            assert.equal(result.isAmbiguous, false);
            assert.equal(result.candidates.length, 1);
            assert.equal(result.candidates[0].selector, "[data-privagent-id=\"pa-qa-btn\"]");
            assert.notEqual(result.candidates[0].selector, "[data-privagent-id=\"pa-qa-link\"]");
        }
    ],
    [
        "QA Test Case Template: detects ambiguous targets and stops safely",
        () => {
            const controls = [
                {
                    type: "button",
                    label: "Add to Cart - QA Test Case Template Starter",
                    selector: "[data-privagent-id='pa-qa-starter']",
                    enabled: true
                },
                {
                    type: "button",
                    label: "Add to Cart - QA Test Case Template Pro",
                    selector: "[data-privagent-id='pa-qa-pro']",
                    enabled: true
                }
            ];

            const result = resolveUnambiguousCandidates(
                "Add QA Test Case Template to the cart",
                controls
            );

            assert.equal(result.isAmbiguous, true);
            assert.equal(result.candidates.length, 0);

            const action = applyCandidateResolution(
                { action: "click", selector: "[data-privagent-id='pa-qa-starter']" },
                result
            );
            assert.equal(action.action, "noop");
        }
    ],
    [
        "Rejects a number changing from 39 to 78 alone as proof that Cypress Checkout Suite was added",
        async () => {
            // Cart badge starts with text containing 39 (e.g. price or unverified number)
            const badgeElement = {
                innerText: "Cart (39)",
                getAttribute: () => null
            };

            let clicked = false;
            const button = {
                disabled: false,
                isConnected: true,
                style: {
                    display: "block",
                    visibility: "visible",
                    opacity: "1",
                    pointerEvents: "auto"
                },
                getBoundingClientRect: () => ({ width: 100, height: 40 }),
                getClientRects: () => [{ width: 100, height: 40 }],
                click: () => {
                    clicked = true;
                    // Number jumps from 39 to 78 (delta 39, e.g. price change $39 -> $78)
                    // but the requested product is NOT in cart items!
                    badgeElement.innerText = "Cart (78)";
                }
            };

            const { sandbox } = createMockEnvironment({
                elements: {
                    "#cypress-btn": button
                },
                querySelectorAll: (sel) => {
                    if (sel && (sel.includes("cart") || sel.includes("bag"))) {
                        return [badgeElement];
                    }
                    return [];
                }
            });

            const result = await sandbox.executeBrowserAction({
                action: "click",
                selector: "#cypress-btn",
                product: "Cypress Checkout Suite",
                timeoutMs: 150
            });

            // Must NOT count as verified proof!
            assert.equal(result.success, false);
            assert.equal(clicked, true);
            assert.equal(result.verified, false);
            assert.equal(
                result.error,
                "Action executed, but 'Cypress Checkout Suite' was not confirmed in the cart."
            );
        }
    ],
    [
        "Rejects price change $39 to $78 alone as proof that Postman API Collection was added",
        () => {
            const { sandbox } = createMockEnvironment();

            const preState = {
                cartTexts: ["$39.00"],
                cartItemsText: "",
                alerts: []
            };

            const postState = {
                cartTexts: ["$78.00"],
                cartItemsText: "",
                alerts: []
            };

            const outcome = sandbox.verifyActionOutcome(
                preState,
                postState,
                "Postman API Collection"
            );

            assert.equal(outcome.verified, false);
            assert.equal(
                outcome.detail,
                "Action executed, but 'Postman API Collection' was not confirmed in the cart."
            );
        }
    ],
    [
        "Confirms Postman API Collection when actually added to cart items",
        () => {
            const { sandbox } = createMockEnvironment();

            const preState = {
                cartTexts: ["Cart (0)"],
                cartItemsText: "",
                alerts: []
            };

            const postState = {
                cartTexts: ["Cart (1)"],
                cartItemsText: "Postman API Collection - ₹1,499",
                alerts: []
            };

            const outcome = sandbox.verifyActionOutcome(
                preState,
                postState,
                "Postman API Collection"
            );

            assert.equal(outcome.verified, true);
            assert.equal(
                outcome.detail,
                "'Postman API Collection' confirmed in cart."
            );
        }
    ],
    [
        "Playwright API UI Bundle: confirmed live HTML selects only add-playwright-api-ui-bundle, never Postman",
        () => {
            let playwrightBtn = null;
            const playwrightCard = {
                tagName: "ARTICLE",
                classList: { contains: (c) => c === "product-card" || c === "ecommerce-product-card" || c === "card" || c === "product" },
                querySelectorAll: (sel) => {
                    if (sel.includes("h1") || sel.includes("h3") || sel.includes("title")) {
                        return [{ tagName: "H3", innerText: "Playwright API + UI Bundle" }];
                    }
                    if (sel.includes("button") && playwrightBtn) {
                        return [playwrightBtn];
                    }
                    return [];
                },
                querySelector: (sel) => {
                    if (sel.includes("h1") || sel.includes("h3") || sel.includes("title")) {
                        return { tagName: "H3", innerText: "Playwright API + UI Bundle" };
                    }
                    return null;
                }
            };

            const playwrightTitleLink = {
                tagName: "A",
                type: "",
                innerText: "Playwright API + UI Bundle",
                parentElement: playwrightCard,
                dataset: { testid: "link-playwright-api-ui-bundle" },
                getAttribute: (attr) => (attr === "data-testid" ? "link-playwright-api-ui-bundle" : null)
            };

            playwrightBtn = {
                tagName: "BUTTON",
                type: "button",
                innerText: "Add to Cart",
                parentElement: playwrightCard,
                dataset: { testid: "add-playwright-api-ui-bundle" },
                getAttribute: (attr) => (attr === "data-testid" ? "add-playwright-api-ui-bundle" : null)
            };

            let postmanBtn = null;
            const postmanCard = {
                tagName: "ARTICLE",
                classList: { contains: (c) => c === "product-card" || c === "ecommerce-product-card" || c === "card" || c === "product" },
                querySelectorAll: (sel) => {
                    if (sel.includes("h1") || sel.includes("h3") || sel.includes("title")) {
                        return [{ tagName: "H3", innerText: "Postman API Collection" }];
                    }
                    if (sel.includes("button") && postmanBtn) {
                        return [postmanBtn];
                    }
                    return [];
                },
                querySelector: (sel) => {
                    if (sel.includes("h1") || sel.includes("h3") || sel.includes("title")) {
                        return { tagName: "H3", innerText: "Postman API Collection" };
                    }
                    return null;
                }
            };

            const postmanTitleLink = {
                tagName: "A",
                type: "",
                innerText: "Postman API Collection",
                parentElement: postmanCard,
                dataset: { testid: "link-postman-api-collection" },
                getAttribute: (attr) => (attr === "data-testid" ? "link-postman-api-collection" : null)
            };

            postmanBtn = {
                tagName: "BUTTON",
                type: "button",
                innerText: "Add to Cart",
                parentElement: postmanCard,
                dataset: { testid: "add-postman-api-collection" },
                getAttribute: (attr) => (attr === "data-testid" ? "add-postman-api-collection" : null)
            };

            const { sandbox } = createMockEnvironment({
                querySelectorAll: () => [
                    playwrightTitleLink,
                    playwrightBtn,
                    postmanTitleLink,
                    postmanBtn
                ]
            });

            const elements = sandbox.findInteractiveElements();
            assert.equal(elements[0].selector, '[data-testid="link-playwright-api-ui-bundle"]');
            assert.equal(elements[1].selector, '[data-testid="add-playwright-api-ui-bundle"]');
            assert.equal(elements[2].selector, '[data-testid="link-postman-api-collection"]');
            assert.equal(elements[3].selector, '[data-testid="add-postman-api-collection"]');

            // Playwright button label must be enriched with card title
            assert.equal(elements[1].label, "Add to Cart - Playwright API + UI Bundle");

            // Postman button label must be enriched with its card title
            assert.equal(elements[3].label, "Add to Cart - Postman API Collection");

            // Goal without plus sign
            const resultWithoutPlus = resolveUnambiguousCandidates(
                "Add Playwright API UI Bundle to the cart",
                elements
            );
            assert.equal(resultWithoutPlus.isAmbiguous, false);
            assert.equal(resultWithoutPlus.candidates.length, 1);
            assert.equal(resultWithoutPlus.candidates[0].selector, '[data-testid="add-playwright-api-ui-bundle"]');
            assert.notEqual(resultWithoutPlus.candidates[0].selector, '[data-testid="add-postman-api-collection"]');
            assert.notEqual(resultWithoutPlus.candidates[0].selector, '[data-testid="link-playwright-api-ui-bundle"]');

            // Goal with plus sign
            const resultWithPlus = resolveUnambiguousCandidates(
                "Add Playwright API + UI Bundle to the cart",
                elements
            );
            assert.equal(resultWithPlus.isAmbiguous, false);
            assert.equal(resultWithPlus.candidates.length, 1);
            assert.equal(resultWithPlus.candidates[0].selector, '[data-testid="add-playwright-api-ui-bundle"]');
            assert.notEqual(resultWithPlus.candidates[0].selector, '[data-testid="add-postman-api-collection"]');

            // Inverse: Postman request picks only Postman, never Playwright
            const postmanResult = resolveUnambiguousCandidates(
                "Add Postman API Collection to the cart",
                elements
            );
            assert.equal(postmanResult.isAmbiguous, false);
            assert.equal(postmanResult.candidates.length, 1);
            assert.equal(postmanResult.candidates[0].selector, '[data-testid="add-postman-api-collection"]');
            assert.notEqual(postmanResult.candidates[0].selector, '[data-testid="add-playwright-api-ui-bundle"]');
        }
    ],
    [
        "Playwright API UI Bundle: confirms cart outcome when item title includes '+'",
        () => {
            const { sandbox } = createMockEnvironment();

            const preState = {
                cartTexts: ["Cart (0)"],
                cartItemsText: "",
                alerts: []
            };

            const postState = {
                cartTexts: ["Cart (1)"],
                cartItemsText: "Playwright API + UI Bundle - $49",
                alerts: []
            };

            // Requesting "playwright api ui bundle" (without plus)
            const outcome = sandbox.verifyActionOutcome(
                preState,
                postState,
                "playwright api ui bundle"
            );

            assert.equal(outcome.verified, true);
            assert.equal(outcome.detail, "'playwright api ui bundle' confirmed in cart.");
        }
    ],
    [
        "Playwright API UI Bundle: rejects verification if Postman API Collection was added instead",
        () => {
            const { sandbox } = createMockEnvironment();

            const preState = {
                cartTexts: ["Cart (0)"],
                cartItemsText: "",
                alerts: []
            };

            const postState = {
                cartTexts: ["Cart (1)"],
                cartItemsText: "Postman API Collection - $39",
                alerts: []
            };

            const outcome = sandbox.verifyActionOutcome(
                preState,
                postState,
                "playwright api ui bundle"
            );

            assert.equal(outcome.verified, false);
            assert.equal(
                outcome.detail,
                "Action executed, but 'playwright api ui bundle' was not confirmed in the cart."
            );
        }
    ],
    [
        "Filters out password and payment inputs while retaining harmless Show/Hide button, Forgot Password link, and Send OTP button",
        () => {
            const mockElements = [
                { tagName: "BUTTON", id: "showBtn", innerText: "Show Password", disabled: false },
                { tagName: "A", id: "forgotLink", innerText: "Forgot Password?", href: "/forgot", disabled: false },
                { tagName: "BUTTON", id: "otpBtn", innerText: "Send OTP", disabled: false },
                { tagName: "INPUT", id: "nameInput", type: "text", placeholder: "Enter your name", disabled: false },
                { tagName: "INPUT", id: "passwordInput", type: "password", placeholder: "Password", disabled: false },
                { tagName: "INPUT", id: "cvvInput", type: "text", placeholder: "CVV", disabled: false },
                { tagName: "INPUT", id: "cardNumInput", type: "text", name: "card_number", disabled: false },
                { tagName: "INPUT", id: "otpInput", type: "text", placeholder: "Enter OTP", disabled: false }
            ];

            const { sandbox } = createMockEnvironment({
                querySelectorAll: (selector) => {
                    if (selector.includes("button, input")) {
                        return mockElements;
                    }
                    return [];
                }
            });

            const controls = sandbox.findInteractiveElements();
            const labels = controls.map(c => c.label);

            // Harmless buttons and links are kept
            assert.ok(labels.includes("Show Password"), "Show Password button should be included");
            assert.ok(labels.includes("Forgot Password?"), "Forgot Password link should be included");
            assert.ok(labels.includes("Send OTP"), "Send OTP button should be included");
            assert.ok(labels.includes("Enter your name"), "Ordinary name input should be included");

            // Sensitive editable fields are filtered out
            assert.ok(!labels.includes("Password"), "Password input must be excluded");
            assert.ok(!labels.includes("CVV"), "CVV input must be excluded");
            assert.ok(!labels.includes("card_number"), "Card number input must be excluded");
            assert.ok(!labels.includes("Enter OTP"), "OTP input must be excluded");
        }
    ],
    [
        "Resolves Forgot Password link and Send OTP button as action candidates without exposing credentials",
        () => {
            const controls = [
                { type: "a", label: "Forgot Password?", selector: "#forgotLink", enabled: true },
                { type: "button", label: "Send OTP", selector: "#otpBtn", enabled: true },
                { type: "button", label: "Show Password", selector: "#showBtn", enabled: true }
            ];

            const forgotResolution = resolveUnambiguousCandidates("click forgot password", controls);
            assert.equal(forgotResolution.isAmbiguous, false);
            assert.equal(forgotResolution.candidates[0].selector, "#forgotLink");

            const otpResolution = resolveUnambiguousCandidates("click send otp", controls);
            assert.equal(otpResolution.isAmbiguous, false);
            assert.equal(otpResolution.candidates[0].selector, "#otpBtn");

            const showResolution = resolveUnambiguousCandidates("click show password", controls);
            assert.equal(showResolution.isAmbiguous, false);
            assert.equal(showResolution.candidates[0].selector, "#showBtn");
        }
    ],
    [
        "Resolves view-history navigation without cart filtering or substring false positives",
        () => {
            const controls = [
                { type: "a", role: "link", label: "View History", selector: "#viewHistory", enabled: true, visible: true },
                { type: "button", role: "button", label: "History Export", selector: "#historyExport", enabled: true, visible: true },
                { type: "button", role: "button", label: "HistoryBook", selector: "#historyBook", enabled: true, visible: true },
                { type: "button", role: "button", label: "Support", selector: "#support", enabled: true, visible: true }
            ];

            const resolution = resolveUnambiguousCandidates("click view history", controls);
            assert.equal(resolution.isAmbiguous, false);
            assert.equal(resolution.candidates.length, 1);
            assert.equal(resolution.candidates[0].selector, "#viewHistory");
            assert.equal(resolution.candidates[0].product, null);

            const addToCart = resolveUnambiguousCandidates("add selenium login test pack to the cart", [
                { type: "button", role: "button", label: "Add to Cart - Selenium Login Test Pack", selector: "#addPack", enabled: true, visible: true }
            ]);
            assert.equal(addToCart.candidates[0].selector, "#addPack");
            assert.equal(addToCart.candidates[0].product, "selenium login test pack");
        }
    ],
    [
        "Resolves contextual tutorial navigation links and toggle buttons without triggering privacy false-positives",
        () => {
            const controls = [
                { type: "a", label: "Password Validation - Trigger Button on Enter", selector: "#link1", enabled: true },
                { type: "a", label: "Toggle Password Visibility - Password Validation", selector: "#link2", enabled: true },
                { type: "button", label: "Toggle Hide and Show button", selector: "#toggleBtn", enabled: true }
            ];

            const toggleResolution = resolveUnambiguousCandidates("click toggle hide and show button", controls);
            assert.equal(toggleResolution.isAmbiguous, false);
            assert.equal(toggleResolution.candidates[0].selector, "#toggleBtn");

            const navResolution = resolveUnambiguousCandidates("click trigger button on enter", controls);
            assert.equal(navResolution.isAmbiguous, false);
            assert.equal(navResolution.candidates[0].selector, "#link1");
        }
    ],
    [
        "Phase 3.1: Resolves one unique exact semantic match with high confidence",
        () => {
            const controls = [
                { type: "button", role: "button", label: "Checkout", selector: "#checkoutBtn", enabled: true, visible: true },
                { type: "a", role: "link", label: "Continue Shopping", selector: "#continueLink", enabled: true, visible: true },
                { type: "button", role: "button", label: "Apply Coupon", selector: "#couponBtn", enabled: true, visible: true }
            ];
            const resolution = resolveUnambiguousCandidates("click checkout button", controls);
            assert.equal(resolution.isAmbiguous, false);
            assert.equal(resolution.candidates.length, 1);
            assert.equal(resolution.candidates[0].selector, "#checkoutBtn");
        }
    ],
    [
        "Phase 3.2: Identifies intended control among similar text matches using role and accessible name",
        () => {
            const controls = [
                { type: "a", role: "link", label: "Settings", ariaLabel: "Settings navigation link", selector: "#linkSettings", enabled: true, visible: true },
                { type: "div", role: "tab", label: "Settings", ariaLabel: "Settings preferences tab", selector: "#tabSettings", enabled: true, visible: true },
                { type: "button", role: "button", label: "Settings", ariaLabel: "Settings quick action button", selector: "#btnSettings", enabled: true, visible: true }
            ];

            // When user requests the "tab"
            const tabRes = resolveUnambiguousCandidates("click Settings tab", controls);
            assert.equal(tabRes.isAmbiguous, false);
            assert.equal(tabRes.candidates[0].selector, "#tabSettings");

            // When user requests the "button"
            const btnRes = resolveUnambiguousCandidates("click Settings button", controls);
            assert.equal(btnRes.isAmbiguous, false);
            assert.equal(btnRes.candidates[0].selector, "#btnSettings");

            // When user requests the "link"
            const linkRes = resolveUnambiguousCandidates("click Settings link", controls);
            assert.equal(linkRes.isAmbiguous, false);
            assert.equal(linkRes.candidates[0].selector, "#linkSettings");
        }
    ],
    [
        "Phase 3.3: Preserves ambiguity for duplicate buttons with genuinely indistinguishable names",
        () => {
            const controls = [
                { type: "button", role: "button", label: "Submit", selector: "#submitBtn1", enabled: true, visible: true },
                { type: "button", role: "button", label: "Submit", selector: "#submitBtn2", enabled: true, visible: true }
            ];
            const resolution = resolveUnambiguousCandidates("click Submit button", controls);
            assert.equal(resolution.isAmbiguous, true, "Must be ambiguous when duplicate buttons share identical name and role");
            assert.equal(resolution.candidates.length, 0);

            const safeAction = applyCandidateResolution({ action: "click", selector: "#submitBtn1" }, resolution);
            assert.equal(safeAction.action, "noop", "Ambiguous resolution must enforce safe noop action");
            assert.equal(safeAction.requires_confirmation, false);
        }
    ],
    [
        "Phase 3.4: Safely resolves navigation links containing words like 'password' without treating them as editable fields",
        () => {
            const controls = [
                { type: "a", role: "link", label: "Forgot Password?", selector: "#forgotPassLink", enabled: true, visible: true },
                { type: "a", role: "link", label: "Password Policy and Guidelines", selector: "#policyLink", enabled: true, visible: true },
                { type: "button", role: "button", label: "Show Password", selector: "#showPassBtn", enabled: true, visible: true }
            ];

            const resolution = resolveUnambiguousCandidates("click Forgot Password link", controls);
            assert.equal(resolution.isAmbiguous, false);
            assert.equal(resolution.candidates[0].selector, "#forgotPassLink");

            const btnRes = resolveUnambiguousCandidates("click Show Password button", controls);
            assert.equal(btnRes.isAmbiguous, false);
            assert.equal(btnRes.candidates[0].selector, "#showPassBtn");
        }
    ],
    [
        "Phase 3.5: Visible and enabled controls strictly outrank hidden or disabled elements with identical labels",
        () => {
            const controls = [
                { type: "button", role: "button", label: "Save Changes", selector: "#disabledSave", enabled: false, visible: true },
                { type: "button", role: "button", label: "Save Changes", selector: "#hiddenSave", enabled: true, visible: false },
                { type: "button", role: "button", label: "Save Changes", selector: "#activeSave", enabled: true, visible: true }
            ];
            const resolution = resolveUnambiguousCandidates("click Save Changes button", controls);
            assert.equal(resolution.isAmbiguous, false, "Must uniquely select the visible, enabled button");
            assert.equal(resolution.candidates[0].selector, "#activeSave");
        }
    ],
    [
        "Phase 3.6: Stale or invalid selectors are safely rejected by browser execution engine",
        async () => {
            const { sandbox, setElements } = createMockEnvironment();
            setElements({}); // Empty DOM: selector will not match anything

            const result = await sandbox.executeBrowserAction({
                action: "click",
                selector: "#staleOrNonExistentElement"
            });
            assert.equal(result.success, false);
            assert.equal(result.error, "Click target not found.");
        }
    ],
    [
        "Phase 3.7: Preserves baseline commands such as 'Click Try it Yourself' and 'Click Remove Ads'",
        () => {
            const controls = [
                { type: "button", role: "button", label: "Try it Yourself", selector: "#tryitBtn", enabled: true, visible: true },
                { type: "a", role: "link", label: "Remove Ads", selector: "#removeAdsLink", enabled: true, visible: true },
                { type: "button", role: "button", label: "Next Chapter", selector: "#nextBtn", enabled: true, visible: true }
            ];

            const tryitRes = resolveUnambiguousCandidates("Click Try it Yourself", controls);
            assert.equal(tryitRes.isAmbiguous, false);
            assert.equal(tryitRes.candidates[0].selector, "#tryitBtn");

            const adsRes = resolveUnambiguousCandidates("Click Remove Ads", controls);
            assert.equal(adsRes.isAmbiguous, false);
            assert.equal(adsRes.candidates[0].selector, "#removeAdsLink");
        }
    ],
    [
        "Phase 3.8: Full planner-to-grounded-selector-to-execution path on a realistic documentation page",
        async () => {
            let toggleClicked = false;
            const mockElements = {
                "#toggleBtn": {
                    tagName: "BUTTON",
                    textContent: "Toggle Hide and Show",
                    disabled: false,
                    isConnected: true,
                    style: { display: "block", visibility: "visible", opacity: "1", pointerEvents: "auto" },
                    getAttribute: (attr) => attr === "aria-disabled" ? "false" : null,
                    getBoundingClientRect: () => ({ width: 120, height: 40 }),
                    getClientRects: () => [{ width: 120, height: 40 }],
                    click: () => { toggleClicked = true; }
                },
                "#navLink": {
                    tagName: "A",
                    textContent: "Toggle Hide and Show",
                    href: "/howto_js_toggle_hide_show.asp",
                    disabled: false,
                    isConnected: true,
                    style: { display: "block", visibility: "visible", opacity: "1", pointerEvents: "auto" },
                    getAttribute: () => null,
                    getBoundingClientRect: () => ({ width: 120, height: 30 }),
                    getClientRects: () => [{ width: 120, height: 30 }],
                    click: () => {}
                }
            };

            const env = createMockEnvironment({ elements: mockElements });

            // 1. Visible controls on documentation page
            const visibleControls = [
                { type: "a", role: "link", label: "Password Validation - Trigger Button on Enter", selector: "#passGuide", enabled: true, visible: true },
                { type: "a", role: "link", label: "Toggle Password Visibility - Password Validation", selector: "#passToggle", enabled: true, visible: true },
                { type: "a", role: "link", label: "Toggle Hide and Show", selector: "#navLink", enabled: true, visible: true },
                { type: "button", role: "button", label: "Toggle Hide and Show", selector: "#toggleBtn", enabled: true, visible: true }
            ];

            // 2. Disambiguate against user goal
            const resolution = resolveUnambiguousCandidates("click Toggle Hide and Show button", visibleControls);
            assert.equal(resolution.isAmbiguous, false);
            assert.equal(resolution.candidates[0].selector, "#toggleBtn");

            // 3. Grounded candidate applied to action
            const action = applyCandidateResolution(
                { action: "click", selector: "#navLink" },
                resolution
            );
            assert.equal(action.action, "click");
            assert.equal(action.selector, "#toggleBtn");

            // 4. Execution in browser sandbox
            const execResult = await env.sandbox.executeBrowserAction(action);
            assert.equal(execResult.success, true);
            assert.equal(toggleClicked, true, "Intended button must have received the DOM click event");
        }
    ],
    [
        "Phase 3.9: Duplicate header controls in aria-hidden or inert sticky headers do not create ambiguity",
        async () => {
            let activeClicked = false;
            let stickyClicked = false;

            const primaryHeader = {
                tagName: "HEADER",
                getAttribute: (attr) => null,
                closest: () => null
            };

            const stickyHeader = {
                tagName: "HEADER",
                getAttribute: (attr) => (attr === "aria-hidden" ? "true" : null),
                closest: (sel) => (sel.includes("aria-hidden") ? stickyHeader : null)
            };

            const activeSearchBtn = {
                tagName: "BUTTON",
                type: "button",
                innerText: "Search",
                parentElement: primaryHeader,
                style: { display: "block", visibility: "visible", opacity: "1", pointerEvents: "auto" },
                getAttribute: (attr) => null,
                closest: (sel) => (sel.includes("aria-hidden") ? null : primaryHeader),
                getBoundingClientRect: () => ({ width: 80, height: 32, top: 20, bottom: 52, left: 200, right: 280 }),
                getClientRects: () => [{ width: 80, height: 32 }],
                click: () => { activeClicked = true; }
            };

            const stickySearchBtn = {
                tagName: "BUTTON",
                type: "button",
                innerText: "Search",
                parentElement: stickyHeader,
                style: { display: "block", visibility: "visible", opacity: "1", pointerEvents: "auto" },
                getAttribute: (attr) => null,
                closest: (sel) => (sel.includes("aria-hidden") ? stickyHeader : null),
                getBoundingClientRect: () => ({ width: 80, height: 32, top: -100, bottom: -68, left: 200, right: 280 }),
                getClientRects: () => [{ width: 80, height: 32 }],
                click: () => { stickyClicked = true; }
            };

            const env = createMockEnvironment({
                elements: {
                    "#activeSearch": activeSearchBtn,
                    "#stickySearch": stickySearchBtn
                }
            });

            // Verify content script visibility check recognizes aria-hidden ancestry
            assert.equal(env.sandbox.isElementVisible(activeSearchBtn), true);
            assert.equal(env.sandbox.isElementVisible(stickySearchBtn), false);

            const visibleControls = [
                { type: "button", role: "button", label: "Search", selector: "#activeSearch", enabled: true, visible: true },
                { type: "button", role: "button", label: "Search", selector: "#stickySearch", enabled: true, visible: false }
            ];

            const resolution = resolveUnambiguousCandidates("click Search button", visibleControls);
            assert.equal(resolution.isAmbiguous, false, "Must uniquely select active button and ignore hidden duplicate");
            assert.equal(resolution.candidates[0].selector, "#activeSearch");

            const execResult = await env.sandbox.executeBrowserAction({
                action: "click",
                selector: resolution.candidates[0].selector
            });
            assert.equal(execResult.success, true);
            assert.equal(activeClicked, true);
            assert.equal(stickyClicked, false);
        }
    ],
    [
        "Phase 3.10: Strict noun constraint button rejects competing search input with higher text match",
        async () => {
            let btnClicked = false;

            const searchForm = {
                tagName: "FORM",
                getAttribute: (attr) => (attr === "aria-label" ? "Site Search" : null),
                closest: () => null,
                querySelector: (sel) => (sel.includes("search") || sel.includes("input") ? searchInput : null)
            };

            const searchInput = {
                tagName: "INPUT",
                type: "search",
                placeholder: "Search Documentation",
                form: searchForm,
                parentElement: searchForm,
                style: { display: "block", visibility: "visible", opacity: "1", pointerEvents: "auto" },
                getAttribute: (attr) => (attr === "placeholder" ? "Search Documentation" : null),
                closest: () => searchForm,
                getBoundingClientRect: () => ({ width: 200, height: 32 }),
                getClientRects: () => [{ width: 200, height: 32 }]
            };

            const searchBtn = {
                tagName: "BUTTON",
                type: "submit",
                innerText: "Search",
                form: searchForm,
                parentElement: searchForm,
                style: { display: "block", visibility: "visible", opacity: "1", pointerEvents: "auto" },
                getAttribute: (attr) => null,
                closest: () => searchForm,
                getBoundingClientRect: () => ({ width: 80, height: 32 }),
                getClientRects: () => [{ width: 80, height: 32 }],
                click: () => { btnClicked = true; }
            };

            const env = createMockEnvironment({
                elements: {
                    "#docSearchInput": searchInput,
                    "#docSearchBtn": searchBtn
                }
            });

            // Container context helper enriches button with form context
            const enrichedContext = env.sandbox.getContainerContext(searchBtn);
            assert.equal(enrichedContext, "Site Search");

            const controls = [
                { type: "input", role: "textbox", label: "Search Documentation", selector: "#docSearchInput", enabled: true, visible: true },
                { type: "button", role: "button", label: "Search - Search Documentation", selector: "#docSearchBtn", enabled: true, visible: true }
            ];

            const resolution = resolveUnambiguousCandidates("click Search Documentation button", controls);
            assert.equal(resolution.isAmbiguous, false, "Must resolve to button, strictly excluding input");
            assert.equal(resolution.candidates[0].selector, "#docSearchBtn");

            const execResult = await env.sandbox.executeBrowserAction({
                action: "click",
                selector: resolution.candidates[0].selector
            });
            assert.equal(execResult.success, true);
            assert.equal(btnClicked, true);
        }
    ],
    [
        "Zero-width and zero-height elements are excluded from visible click targets",
        () => {
            const env = createMockEnvironment();
            const zeroWidth = {
                style: { display: "block", visibility: "visible", opacity: "1", pointerEvents: "auto" },
                getAttribute: () => null,
                getBoundingClientRect: () => ({ width: 0, height: 24, top: 0, right: 0, bottom: 24, left: 0 }),
                getClientRects: () => [{ width: 0, height: 24 }]
            };
            const zeroHeight = {
                style: { display: "block", visibility: "visible", opacity: "1", pointerEvents: "auto" },
                getAttribute: () => null,
                getBoundingClientRect: () => ({ width: 80, height: 0, top: 0, right: 80, bottom: 0, left: 0 }),
                getClientRects: () => [{ width: 80, height: 0 }]
            };

            assert.equal(env.sandbox.isElementVisible(zeroWidth), false);
            assert.equal(env.sandbox.isElementVisible(zeroHeight), false);

            const resolution = resolveUnambiguousCandidates("click Search button", [
                { type: "button", role: "button", label: "Search", selector: "#zeroWidth", enabled: true, visible: false },
                { type: "button", role: "button", label: "Search", selector: "#zeroHeight", enabled: true, visible: false }
            ]);
            assert.equal(resolution.candidates.length, 0);
        }
    ],
    [
        "Phase 3.11: Links inside collapsed disclosure widgets are rejected by visibility and candidate resolution",
        async () => {
            const dropdownContainer = {
                id: "langMenu",
                tagName: "DIV",
                classList: { contains: (c) => c === "dropdown-menu" },
                getAttribute: (attr) => null,
                closest: (sel) => null
            };

            const dropdownTrigger = {
                tagName: "BUTTON",
                getAttribute: (attr) => {
                    if (attr === "aria-expanded") return "false";
                    if (attr === "aria-controls") return "langMenu";
                    return null;
                },
                contains: (el) => el === dropdownTrigger
            };

            const hiddenLink = {
                tagName: "A",
                href: "/en",
                innerText: "English Documentation",
                parentElement: dropdownContainer,
                style: { display: "block", visibility: "visible", opacity: "1", pointerEvents: "auto" },
                getAttribute: (attr) => null,
                closest: (sel) => {
                    if (sel.includes("role='menu'") || sel.includes("dropdown-menu")) return dropdownContainer;
                    return null;
                },
                getBoundingClientRect: () => ({ width: 120, height: 24 }),
                getClientRects: () => [{ width: 120, height: 24 }],
                click: () => {}
            };

            dropdownContainer.contains = (el) => el === hiddenLink;

            const env = createMockEnvironment({
                elements: {
                    "#langTrigger": dropdownTrigger,
                    "#enLink": hiddenLink,
                    "button[aria-expanded='false'][aria-controls='langMenu']": dropdownTrigger
                }
            });

            // In sandbox, document.querySelector must return controller for aria-controls lookup
            env.sandbox.document.querySelector = (sel) => {
                if (sel && sel.includes("aria-expanded=\"false\"") && sel.includes("langMenu")) {
                    return dropdownTrigger;
                }
                if (sel === "#enLink") return hiddenLink;
                if (sel === "#langTrigger") return dropdownTrigger;
                return null;
            };

            // 1. isElementVisible identifies link is inside a collapsed disclosure
            assert.equal(env.sandbox.isElementVisible(hiddenLink), false);

            // 2. Direct execution attempt safely fails
            const execResult = await env.sandbox.executeBrowserAction({
                action: "click",
                selector: "#enLink"
            });
            assert.equal(execResult.success, false);
            assert.equal(execResult.error, "Click target is not visible or interactive.");

            // 3. Candidate resolution with requested button cannot resolve to link
            const controls = [
                { type: "a", role: "link", label: "English Documentation", selector: "#enLink", enabled: true, visible: false }
            ];
            const btnResolution = resolveUnambiguousCandidates("click English Documentation button", controls);
            assert.equal(btnResolution.candidates.length, 0);
        }
    ],
    [
        "Phase 3.12: Full real transformation and resolution pipeline preserves metadata and refuses genuine duplicate ambiguity",
        async () => {
            const { sanitizePageState } = require("../extension/privacy-gate.js");

            let cancel1Clicked = false;
            let cancel2Clicked = false;

            const cancelBtn1 = {
                id: "cancelBtn1",
                tagName: "BUTTON",
                type: "button",
                innerText: "Cancel",
                dataset: {},
                style: { display: "block", visibility: "visible", opacity: "1", pointerEvents: "auto" },
                getAttribute: () => null,
                getBoundingClientRect: () => ({ width: 80, height: 30, top: 100, bottom: 130, left: 50, right: 130 }),
                getClientRects: () => [{ width: 80, height: 30 }],
                click: () => { cancel1Clicked = true; }
            };

            const cancelBtn2 = {
                id: "cancelBtn2",
                tagName: "BUTTON",
                type: "button",
                innerText: "Cancel",
                dataset: {},
                style: { display: "block", visibility: "visible", opacity: "1", pointerEvents: "auto" },
                getAttribute: () => null,
                getBoundingClientRect: () => ({ width: 80, height: 30, top: 200, bottom: 230, left: 50, right: 130 }),
                getClientRects: () => [{ width: 80, height: 30 }],
                click: () => { cancel2Clicked = true; }
            };

            const envA = createMockEnvironment({
                elements: {
                    "#cancelBtn1": cancelBtn1,
                    "#cancelBtn2": cancelBtn2
                }
            });

            // 1. Raw elements from DOM
            const rawElements = [
                { id: "cancelBtn1", type: "button", role: "button", label: "Cancel", ariaLabel: "Cancel Action", selector: "#cancelBtn1", enabled: true, visible: true, width: 80, height: 30 },
                { id: "cancelBtn2", type: "button", role: "button", label: "Cancel", ariaLabel: "Cancel Action", selector: "#cancelBtn2", enabled: true, visible: true, width: 80, height: 30 }
            ];

            // 2. Privacy gate transforms page elements while preserving metadata
            const sanitizedState = sanitizePageState({
                title: "Confirm Action",
                url: "https://example.com/confirm",
                elements: rawElements
            });
            assert.equal(sanitizedState.elements[0].ariaLabel, "Cancel Action");
            assert.equal(sanitizedState.elements[0].role, "button");
            assert.equal(sanitizedState.elements[0].visible, true);

            // 3. Background maps to visibleControls
            const visibleControls = sanitizedState.elements.map(el => ({
                type: el.type || "unknown",
                role: el.role || "",
                label: el.label || "",
                ariaLabel: el.ariaLabel || "",
                selector: el.selector || null,
                enabled: el.enabled !== false,
                visible: el.visible !== false,
                width: el.width,
                height: el.height
            }));

            // 4. Candidate resolution detects genuine ambiguity
            const resolution = resolveUnambiguousCandidates("click cancel button", visibleControls);
            assert.equal(resolution.isAmbiguous, true, "Must flag genuine ambiguity when two identical buttons match");
            assert.equal(resolution.candidates.length, 0);

            // 5. Authoritative extension candidate resolution overrides server action to noop
            const finalAction = applyCandidateResolution(
                { action: "click", selector: "#cancelBtn1" },
                resolution
            );
            assert.equal(finalAction.action, "noop", "Must safely degrade to noop");

            // 6. Browser execution of noop never interacts with DOM
            const execResult = await envA.sandbox.executeBrowserAction(finalAction);
            assert.equal(execResult.action, "noop");
            assert.equal(cancel1Clicked, false);
            assert.equal(cancel2Clicked, false);
        }
    ],
    [
        "Resolves 'click random article' uniquely when target exists and ignores unrelated article links",
        () => {
            const controls = [
                { type: "a", role: "link", label: "Nominate an article", selector: "#nominate-article", enabled: true, visible: true },
                { type: "a", role: "link", label: "Start a new article", selector: "#start-article", enabled: true, visible: true },
                { type: "a", role: "link", label: "Random article", selector: "#n-randompage", enabled: true, visible: true }
            ];

            const resolution = resolveUnambiguousCandidates("click random article", controls);
            assert.equal(resolution.isAmbiguous, false, "Should resolve uniquely when 'Random article' exists");
            assert.equal(resolution.candidates.length, 1);
            assert.equal(resolution.candidates[0].selector, "#n-randompage");
            assert.equal(resolution.candidates[0].action, "click");
        }
    ],
    [
        "Preserves safe refusal when multiple genuinely duplicate 'Random article' links exist",
        () => {
            const controls = [
                { type: "a", role: "link", label: "Random article", selector: "#n-randompage-sidebar", enabled: true, visible: true },
                { type: "a", role: "link", label: "Random article", selector: "#n-randompage-footer", enabled: true, visible: true }
            ];

            const resolution = resolveUnambiguousCandidates("click random article", controls);
            assert.equal(resolution.isAmbiguous, true, "Must flag ambiguity when duplicate 'Random article' links exist");
            assert.equal(resolution.candidates.length, 0);
        }
    ],
    [
        "Missing 'Random article' does not trigger false ambiguity on unrelated article links",
        () => {
            const controls = [
                { type: "a", role: "link", label: "Nominate an article", selector: "#nominate-article", enabled: true, visible: true },
                { type: "a", role: "link", label: "Start a new article", selector: "#start-article", enabled: true, visible: true }
            ];

            const resolution = resolveUnambiguousCandidates("click random article", controls);
            assert.equal(resolution.isAmbiguous, false, "Must not trigger false ambiguity for unrelated article links");
            assert.equal(resolution.candidates.length, 0);
        }
    ],
    [
        "Resolves 'type cats into the Search Wikipedia field' to grounded search textbox and executes typing",
        async () => {
            const controls = [
                { type: "search", role: "searchbox", label: "Search Wikipedia", ariaLabel: "Search Wikipedia", selector: "#searchInput", enabled: true, visible: true },
                { type: "button", role: "button", label: "Search", selector: "#searchButton", enabled: true, visible: true }
            ];

            const resolution = resolveUnambiguousCandidates("type cats into the Search Wikipedia field", controls);
            assert.equal(resolution.isAmbiguous, false);
            assert.equal(resolution.candidates.length, 1);
            assert.equal(resolution.candidates[0].action, "type");
            assert.equal(resolution.candidates[0].selector, "#searchInput");
            assert.equal(resolution.candidates[0].value, "cats");

            let currentVal = "";
            let dispatchedEvents = [];
            const mockInput = {
                tagName: "INPUT",
                type: "search",
                dataset: {},
                style: { display: "block", visibility: "visible", opacity: "1", pointerEvents: "auto" },
                getAttribute: (attr) => attr === "type" ? "search" : null,
                getBoundingClientRect: () => ({ width: 200, height: 30, top: 10, bottom: 40, left: 10, right: 210 }),
                getClientRects: () => [{ width: 200, height: 30 }],
                focus: () => {},
                dispatchEvent: (ev) => { dispatchedEvents.push(ev?.type); },
                get value() { return currentVal; },
                set value(v) { currentVal = v; }
            };

            const env = createMockEnvironment({
                elements: {
                    "#searchInput": mockInput
                }
            });

            const execResult = await env.sandbox.executeBrowserAction(resolution.candidates[0]);
            assert.equal(execResult.success, true);
            assert.equal(execResult.action, "type");
            assert.equal(currentVal, "cats");
        }
    ],
    [
        "Resolves 'search wikipedia for cats' with submit=true and handles form submission safely",
        async () => {
            const controls = [
                { type: "search", role: "searchbox", label: "Search Wikipedia", selector: "#searchInput", enabled: true, visible: true },
                { type: "button", role: "button", label: "Search", selector: "#searchButton", enabled: true, visible: true }
            ];

            const resolution = resolveUnambiguousCandidates("search wikipedia for cats", controls);
            assert.equal(resolution.isAmbiguous, false);
            assert.equal(resolution.candidates.length, 1);
            assert.equal(resolution.candidates[0].action, "type");
            assert.equal(resolution.candidates[0].selector, "#searchInput");
            assert.equal(resolution.candidates[0].value, "cats");
            assert.equal(resolution.candidates[0].submit, true);

            let currentVal = "";
            let formSubmitted = false;
            const mockForm = {
                requestSubmit: () => { formSubmitted = true; }
            };
            const mockInput = {
                tagName: "INPUT",
                type: "search",
                dataset: {},
                style: { display: "block", visibility: "visible", opacity: "1", pointerEvents: "auto" },
                getAttribute: (attr) => attr === "type" ? "search" : null,
                getBoundingClientRect: () => ({ width: 200, height: 30, top: 10, bottom: 40, left: 10, right: 210 }),
                getClientRects: () => [{ width: 200, height: 30 }],
                focus: () => {},
                dispatchEvent: () => {},
                form: mockForm,
                get value() { return currentVal; },
                set value(v) { currentVal = v; }
            };

            const env = createMockEnvironment({
                elements: {
                    "#searchInput": mockInput
                }
            });

            const execResult = await env.sandbox.executeBrowserAction(resolution.candidates[0]);
            assert.equal(execResult.success, true);
            assert.equal(execResult.action, "type");
            assert.equal(currentVal, "cats");
            assert.equal(formSubmitted, true);
        }
    ]
];

(async () => {
    let failures = 0;

    for (const [name, test] of tests) {
        try {
            await test();
            console.log(`PASS: ${name}`);
        } catch (error) {
            failures++;
            console.error(`FAIL: ${name}`);
            console.error(`  ${error.message}`);
        }
    }

    console.log(`\n${tests.length - failures}/${tests.length} browser action tests passed.`);

    if (failures > 0) {
        process.exitCode = 1;
    } else {
        console.log("All browser action execution tests passed.");
    }
})();
