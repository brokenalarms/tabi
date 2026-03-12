// HintMode unit tests — using Node.js built-in test runner
// Tests label generation, element discovery filtering, hint overlay
// rendering, progressive filtering, and click dispatch.

const { describe, it, beforeEach, afterEach, mock } = require("node:test");
const assert = require("node:assert/strict");

// --- Minimal DOM shim ---

let capturedListeners, keyHandler, hintMode;
let bodyEl, htmlEl;

function makeElement(tag, opts = {}) {
    const rect = {
        top: opts.top ?? 0,
        left: opts.left ?? 0,
        bottom: opts.bottom ?? 20,
        right: opts.right ?? 100,
        width: opts.width ?? 100,
        height: opts.height ?? 20,
    };
    const style = {
        visibility: opts.visibility || "visible",
        display: opts.display || "block",
        opacity: opts.opacity ?? "1",
        cursor: opts.cursor || "default",
        overflow: opts.overflow || "visible",
        paddingTop: opts.paddingTop || "0px",
    };
    const children = opts.children || [];
    return {
        tagName: tag,
        href: opts.href || "",
        type: opts.type || "",
        isContentEditable: false,
        shadowRoot: opts.shadowRoot || null,
        parentNode: opts.parentNode || null,
        parentElement: opts.parentElement || null,
        firstElementChild: children[0] || null,
        children: children,
        getBoundingClientRect: () => rect,
        getClientRects: () => {
            if (rect.width > 1 && rect.height > 1) return [rect];
            return [];
        },
        _style: style,
        _children: children,
        contains(other) {
            let node = other;
            while (node) {
                if (node === this) return true;
                node = node.parentElement;
            }
            return false;
        },
        focus: mock.fn(),
        click: mock.fn(),
        querySelector(sel) {
            const matches = this.querySelectorAll(sel);
            return matches.length > 0 ? matches[0] : null;
        },
        querySelectorAll(sel) {
            // Return children that match (simplified: return all children)
            if (sel === "*") return this._children;
            // For CLICKABLE_SELECTOR, return children that are "clickable"
            return this._children.filter((c) => {
                const clickableTags = ["A", "BUTTON", "INPUT", "TEXTAREA", "SELECT", "SUMMARY", "DETAILS"];
                return clickableTags.includes(c.tagName);
            });
        },
    };
}

function makeKeyEvent(code, opts = {}) {
    return {
        code,
        key: opts.key || "",
        shiftKey: opts.shift || false,
        ctrlKey: opts.ctrl || false,
        altKey: opts.alt || false,
        metaKey: opts.meta || false,
        preventDefault: mock.fn(),
        stopPropagation: mock.fn(),
    };
}

function setupDOM(elements = []) {
    capturedListeners = {};
    bodyEl = makeElement("BODY");
    htmlEl = makeElement("HTML");

    const createdEls = [];

    global.document = {
        addEventListener(type, fn, capture) {
            if (!capturedListeners[type]) capturedListeners[type] = [];
            capturedListeners[type].push(fn);
        },
        removeEventListener(type, fn, capture) {
            if (capturedListeners[type]) {
                capturedListeners[type] = capturedListeners[type].filter((f) => f !== fn);
            }
        },
        activeElement: bodyEl,
        body: bodyEl,
        documentElement: htmlEl,
        head: htmlEl,
        visibilityState: "visible",
        querySelectorAll(sel) {
            if (sel === "*") return elements;
            return elements.filter((e) => {
                const clickableTags = ["A", "BUTTON", "INPUT", "TEXTAREA", "SELECT", "SUMMARY", "DETAILS"];
                if (clickableTags.includes(e.tagName)) return true;
                // Match elements with tabindex (mimics [tabindex]:not([tabindex='-1']))
                if (e._tabindex !== undefined && e._tabindex !== "-1") return true;
                return false;
            });
        },
        createElement(tag) {
            const el = {
                tagName: tag.toUpperCase(),
                className: "",
                textContent: "",
                innerHTML: "",
                style: {},
                children: [],
                parentNode: null,
                appendChild(child) {
                    this.children.push(child);
                    child.parentNode = this;
                },
                removeChild(child) {
                    this.children = this.children.filter((c) => c !== child);
                    child.parentNode = null;
                },
            };
            createdEls.push(el);
            return el;
        },
        createTextNode(text) {
            return { nodeType: 3, textContent: text };
        },
        elementFromPoint(x, y) {
            // Default: return the first element (good enough for most tests)
            return elements.length > 0 ? elements[0] : null;
        },
    };

    // Make body appendable
    bodyEl.appendChild = function (child) {
        child.parentNode = bodyEl;
    };
    bodyEl.removeChild = function (child) {
        child.parentNode = null;
    };
    htmlEl.appendChild = function (child) {
        child.parentNode = htmlEl;
    };
    htmlEl.removeChild = function (child) {
        child.parentNode = null;
    };

    global.window = {
        innerWidth: 1024,
        innerHeight: 768,
        focus: mock.fn(),
        addEventListener: mock.fn(),
    };
    global.getComputedStyle = (el) => el._style || { visibility: "visible", display: "block", opacity: "1", cursor: "default" };
    global.clearTimeout = clearTimeout;
    global.setTimeout = setTimeout;
    global.browser = {
        runtime: { sendMessage: mock.fn() },
    };
}

function loadModules(elements = []) {
    setupDOM(elements);
    const path = require("node:path");
    const khPath = path.resolve(__dirname, "../Vimium/Safari Extension/Resources/modules/KeyHandler.js");
    const hmPath = path.resolve(__dirname, "../Vimium/Safari Extension/Resources/modules/HintMode.js");
    delete require.cache[khPath];
    delete require.cache[hmPath];
    require(khPath);
    require(hmPath);
    keyHandler = new global.KeyHandler();
    hintMode = new global.HintMode(keyHandler);
    hintMode.wireCommands();
    keyHandler.on("exitToNormal", () => {
        if (hintMode.isActive()) hintMode.deactivate();
        keyHandler.setMode(global.Mode.NORMAL);
    });
}

function fireKeyDown(event) {
    const listeners = capturedListeners["keydown"] || [];
    for (const fn of [...listeners]) fn(event);
}

function fireMouseDown() {
    const listeners = capturedListeners["mousedown"] || [];
    for (const fn of [...listeners]) fn({});
}

describe("HintMode", () => {
    afterEach(() => {
        if (hintMode) hintMode.destroy();
        if (keyHandler) keyHandler.destroy();
    });

    describe("Label generation", () => {
        beforeEach(() => loadModules());

        // Generates single-character labels when count fits alphabet size
        it("generates single-char labels for small counts", () => {
            const labels = HintMode.generateLabels(3);
            assert.equal(labels.length, 3);
            assert.equal(labels[0], "s");
            assert.equal(labels[1], "a");
            assert.equal(labels[2], "d");
        });

        // Generates two-character labels when count exceeds alphabet size
        it("generates two-char labels when count exceeds alphabet", () => {
            const labels = HintMode.generateLabels(15);
            assert.equal(labels.length, 15);
            // With 14 hint chars, 15 hints need 2-char labels
            assert.equal(labels[0].length, 2);
            assert.equal(labels[0], "ss");
            assert.equal(labels[1], "sa");
        });

        // Returns empty array for zero count
        it("returns empty for zero count", () => {
            assert.deepStrictEqual(HintMode.generateLabels(0), []);
        });

        // All labels are unique
        it("generates unique labels", () => {
            const labels = HintMode.generateLabels(50);
            const unique = new Set(labels);
            assert.equal(unique.size, 50);
        });
    });

    describe("Activation and mode transition", () => {
        // Activating hints switches KeyHandler to HINTS mode
        it("sets HINTS mode on activation", () => {
            const link = makeElement("A", { href: "https://example.com", top: 10, left: 10 });
            loadModules([link]);
            hintMode.activate(false);
            assert.equal(keyHandler.getMode(), "HINTS");
            assert.ok(hintMode.isActive());
        });

        // Deactivating returns to NORMAL mode
        it("returns to NORMAL mode on deactivation", () => {
            const link = makeElement("A", { href: "https://example.com", top: 10, left: 10 });
            loadModules([link]);
            hintMode.activate(false);
            hintMode.deactivate();
            assert.equal(keyHandler.getMode(), "NORMAL");
            assert.ok(!hintMode.isActive());
        });

        // Deactivates immediately when no elements found
        it("deactivates if no visible elements found", () => {
            loadModules([]);
            hintMode.activate(false);
            assert.equal(keyHandler.getMode(), "NORMAL");
            assert.ok(!hintMode.isActive());
        });
    });

    describe("Element discovery", () => {
        // Skips elements outside the viewport
        it("filters out elements below viewport", () => {
            const visible = makeElement("A", { href: "#", top: 10, left: 0 });
            const below = makeElement("A", { href: "#", top: 1000, bottom: 1020 });
            loadModules([visible, below]);
            hintMode.activate(false);
            // Only one hint should be created (the visible one)
            // The below-viewport element has top > innerHeight (768)
            assert.ok(hintMode.isActive());
        });

        // Skips hidden elements (display:none)
        it("filters out display:none elements", () => {
            const hidden = makeElement("A", { href: "#", display: "none", top: 10, left: 0 });
            loadModules([hidden]);
            hintMode.activate(false);
            // No visible elements → deactivates
            assert.ok(!hintMode.isActive());
        });

        // Skips zero-size elements
        it("filters out zero-size elements", () => {
            const zeroSize = makeElement("A", { href: "#", width: 0, height: 0, top: 10, left: 0 });
            loadModules([zeroSize]);
            hintMode.activate(false);
            assert.ok(!hintMode.isActive());
        });

        // Zero-size <a> with visible child falls back to child rect
        it("falls back to firstElementChild for zero-size anchors", () => {
            const child = makeElement("H3", { top: 10, left: 20, width: 200, height: 24 });
            const anchor = makeElement("A", { href: "#", width: 0, height: 0, top: 0, left: 0, children: [child] });
            loadModules([anchor]);
            hintMode.activate(false);
            assert.ok(hintMode.isActive());
        });

        // Wrapper div with tabindex containing a textarea — only textarea gets a hint
        it("filters out ancestor wrapper when descendant is also a candidate", () => {
            const textarea = makeElement("TEXTAREA", { top: 10, left: 10 });
            const wrapper = makeElement("DIV", { top: 10, left: 10 });
            wrapper._tabindex = "0";
            textarea.parentElement = wrapper;
            textarea.parentNode = wrapper;
            wrapper._children = [textarea];
            wrapper.children = [textarea];

            loadModules([wrapper, textarea]);

            // Need elementFromPoint to return the element itself for visibility
            global.document.elementFromPoint = (x, y) => {
                // Return the textarea for any point check (both are at same position)
                return textarea;
            };

            hintMode.activate(false);
            assert.ok(hintMode.isActive());
            // Access internal hints via the overlay children count
            // Only 1 hint (textarea), not 2 (wrapper filtered out)
            const overlay = global.document.body.children
                ? global.document.body.children[0]
                : null;
            // hintMode._hints is private, so check via label: with 1 element, label is "s"
            // Type "s" to activate — if there were 2 hints, labels would be "ss","sa" (2-char)
            fireKeyDown(makeKeyEvent("KeyS", { key: "s" }));
            // If only 1 hint, typing "s" activates it and deactivates hint mode
            assert.ok(!hintMode.isActive(), "Expected 1 hint (textarea only), but got more — wrapper was not filtered");
        });
    });

    describe("Progressive filtering", () => {
        // Typing a label character narrows visible hints
        it("hides non-matching hints as user types", () => {
            const links = [];
            // Create enough links to need multi-char labels (>14)
            for (let i = 0; i < 15; i++) {
                links.push(makeElement("A", { href: "#" + i, top: i * 20, left: 0 }));
            }
            loadModules(links);
            hintMode.activate(false);
            assert.ok(hintMode.isActive());

            // Type first char — should filter
            fireKeyDown(makeKeyEvent("KeyS", { key: "s" }));
            // Still active (multiple hints start with 's')
            assert.ok(hintMode.isActive());
        });

        // Escape deactivates hint mode
        it("deactivates on Escape", () => {
            const link = makeElement("A", { href: "#", top: 10, left: 0 });
            loadModules([link]);
            hintMode.activate(false);
            fireKeyDown(makeKeyEvent("Escape"));
            assert.ok(!hintMode.isActive());
            assert.equal(keyHandler.getMode(), "NORMAL");
        });

        // Backspace removes last typed character
        it("backspace removes last typed character", () => {
            const links = [];
            for (let i = 0; i < 15; i++) {
                links.push(makeElement("A", { href: "#" + i, top: i * 20, left: 0 }));
            }
            loadModules(links);
            hintMode.activate(false);

            fireKeyDown(makeKeyEvent("KeyS", { key: "s" }));
            fireKeyDown(makeKeyEvent("Backspace"));
            // Still active after backspace — all hints visible again
            assert.ok(hintMode.isActive());
        });

        // Any non-hint key dismisses hints
        it("deactivates on non-hint key", () => {
            const link = makeElement("A", { href: "#", top: 10, left: 0 });
            loadModules([link]);
            hintMode.activate(false);

            fireKeyDown(makeKeyEvent("KeyZ", { key: "z" }));
            assert.ok(!hintMode.isActive());
            assert.equal(keyHandler.getMode(), "NORMAL");
        });

        // Mouse click dismisses hints
        it("deactivates on mousedown", () => {
            const link = makeElement("A", { href: "#", top: 10, left: 0 });
            loadModules([link]);
            hintMode.activate(false);

            fireMouseDown();
            assert.ok(!hintMode.isActive());
            assert.equal(keyHandler.getMode(), "NORMAL");
        });
    });

    describe("Click dispatch", () => {
        // Clicking a hint in current-tab mode calls element.click()
        it("clicks element for f-mode (current tab)", () => {
            const link = makeElement("A", { href: "https://example.com", top: 10, left: 0 });
            loadModules([link]);
            hintMode.activate(false);

            // With 1 element, label is single char "s"
            fireKeyDown(makeKeyEvent("KeyS", { key: "s" }));
            assert.equal(link.click.mock.callCount(), 1);
            assert.ok(!hintMode.isActive());
        });

        // F-mode (new tab) sends message to background for links
        it("sends createTab message for F-mode on links", () => {
            const link = makeElement("A", { href: "https://example.com", top: 10, left: 0 });
            loadModules([link]);
            hintMode.activate(true);

            fireKeyDown(makeKeyEvent("KeyS", { key: "s" }));
            assert.equal(global.browser.runtime.sendMessage.mock.callCount(), 1);
            const msg = global.browser.runtime.sendMessage.mock.calls[0].arguments[0];
            assert.equal(msg.command, "createTab");
            assert.equal(msg.url, "https://example.com");
            assert.ok(!hintMode.isActive());
        });

        // F-mode falls back to click for non-link elements
        it("falls back to click for non-link elements in F-mode", () => {
            const btn = makeElement("BUTTON", { top: 10, left: 0 });
            loadModules([btn]);
            hintMode.activate(true);

            fireKeyDown(makeKeyEvent("KeyS", { key: "s" }));
            assert.equal(btn.click.mock.callCount(), 1);
        });
    });

    describe("Command wiring", () => {
        // f key triggers activateHints via KeyHandler
        it("f triggers hint activation via command", () => {
            const link = makeElement("A", { href: "#", top: 10, left: 0 });
            loadModules([link]);

            // Simulate pressing f in NORMAL mode
            fireKeyDown(makeKeyEvent("KeyF"));
            assert.ok(hintMode.isActive());
            assert.equal(keyHandler.getMode(), "HINTS");
        });

        // Shift+F triggers new-tab hint activation
        it("Shift+F triggers new-tab hint activation", () => {
            const link = makeElement("A", { href: "#", top: 10, left: 0 });
            loadModules([link]);

            fireKeyDown(makeKeyEvent("KeyF", { shift: true }));
            assert.ok(hintMode.isActive());
        });

        // unwireCommands prevents f from activating hints
        it("unwireCommands disables hint activation", () => {
            const link = makeElement("A", { href: "#", top: 10, left: 0 });
            loadModules([link]);
            hintMode.unwireCommands();

            fireKeyDown(makeKeyEvent("KeyF"));
            assert.ok(!hintMode.isActive());
        });

        // wireCommands re-enables after unwire
        it("wireCommands re-enables hint activation", () => {
            const link = makeElement("A", { href: "#", top: 10, left: 0 });
            loadModules([link]);
            hintMode.unwireCommands();
            hintMode.wireCommands();

            fireKeyDown(makeKeyEvent("KeyF"));
            assert.ok(hintMode.isActive());
        });
    });

    describe("destroy()", () => {
        // After destroy, activateHints command is unregistered
        it("unregisters hint commands from KeyHandler", () => {
            const link = makeElement("A", { href: "#", top: 10, left: 0 });
            loadModules([link]);
            hintMode.destroy();

            // f should no longer activate hints
            fireKeyDown(makeKeyEvent("KeyF"));
            assert.ok(!hintMode.isActive());
        });
    });
});
