// ScrollController unit tests — using Node.js built-in test runner
// Tests scroll target detection, directional scrolling, half-page scrolling,
// absolute scrolling, and history navigation command wiring.

const { describe, it, beforeEach, afterEach, mock } = require("node:test");
const assert = require("node:assert/strict");

// --- Minimal DOM shim ---

function makeElement(opts = {}) {
    const style = {
        overflowX: opts.overflowX || "visible",
        overflowY: opts.overflowY || "visible",
    };
    return {
        tagName: opts.tag || "DIV",
        scrollWidth: opts.scrollWidth || 100,
        scrollHeight: opts.scrollHeight || 100,
        clientWidth: opts.clientWidth || 100,
        clientHeight: opts.clientHeight || 600,
        parentElement: opts.parent || null,
        scrollBy: mock.fn(),
        scrollTo: mock.fn(),
        _style: style,
    };
}

let capturedListeners, keyHandler, scrollController;
let documentBody, documentScrollingElement;

function setupDOM() {
    capturedListeners = {};
    documentBody = makeElement({ tag: "BODY" });
    documentScrollingElement = makeElement({
        tag: "HTML",
        scrollHeight: 5000,
        clientHeight: 800,
    });

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
        activeElement: documentBody,
        body: documentBody,
        documentElement: documentScrollingElement,
        scrollingElement: documentScrollingElement,
    };

    global.getComputedStyle = (el) => el._style;
    global.history = { back: mock.fn(), forward: mock.fn() };
    global.clearTimeout = clearTimeout;
    global.setTimeout = setTimeout;
}

function loadModules() {
    setupDOM();
    const path = require("node:path");
    const khPath = path.resolve(__dirname, "../Vimium/Safari Extension/Resources/modules/KeyHandler.js");
    const scPath = path.resolve(__dirname, "../Vimium/Safari Extension/Resources/modules/ScrollController.js");
    delete require.cache[khPath];
    delete require.cache[scPath];
    require(khPath);
    require(scPath);
    keyHandler = new global.KeyHandler();
    scrollController = new global.ScrollController(keyHandler);
}

function makeKeyEvent(code, opts = {}) {
    return {
        code,
        shiftKey: opts.shift || false,
        ctrlKey: opts.ctrl || false,
        altKey: opts.alt || false,
        metaKey: opts.meta || false,
        preventDefault: mock.fn(),
        stopPropagation: mock.fn(),
    };
}

function fireKeyDown(event) {
    const listeners = capturedListeners["keydown"] || [];
    for (const fn of listeners) fn(event);
}

describe("ScrollController", () => {
    beforeEach(() => loadModules());
    afterEach(() => {
        if (scrollController) scrollController.destroy();
        if (keyHandler) keyHandler.destroy();
    });

    describe("findScrollTarget", () => {
        // Falls back to document.scrollingElement when active element is body
        it("returns document.scrollingElement when active element is body", () => {
            const target = ScrollController.findScrollTarget("y");
            assert.strictEqual(target, documentScrollingElement);
        });

        // Finds a scrollable ancestor of the focused element
        it("finds scrollable ancestor of focused element", () => {
            const scrollableDiv = makeElement({
                overflowY: "auto",
                scrollHeight: 2000,
                clientHeight: 400,
            });
            const child = makeElement({ parent: scrollableDiv });
            global.document.activeElement = child;

            const target = ScrollController.findScrollTarget("y");
            assert.strictEqual(target, scrollableDiv);
        });

        // Falls through non-scrollable ancestors to document.scrollingElement
        it("skips non-scrollable ancestors", () => {
            const nonScrollable = makeElement({ overflowY: "visible" });
            const child = makeElement({ parent: nonScrollable });
            nonScrollable.parentElement = documentBody;
            global.document.activeElement = child;

            const target = ScrollController.findScrollTarget("y");
            assert.strictEqual(target, documentScrollingElement);
        });

        // Detects horizontal scrollability for x-axis
        it("detects horizontal scrollability", () => {
            const hScroll = makeElement({
                overflowX: "scroll",
                scrollWidth: 2000,
                clientWidth: 400,
            });
            const child = makeElement({ parent: hScroll });
            global.document.activeElement = child;

            const target = ScrollController.findScrollTarget("x");
            assert.strictEqual(target, hScroll);
        });
    });

    describe("Step scroll (j/k/h/l)", () => {
        // Pressing j scrolls the document down by SCROLL_STEP pixels
        it("j scrolls down", () => {
            fireKeyDown(makeKeyEvent("KeyJ"));
            assert.equal(documentScrollingElement.scrollBy.mock.callCount(), 1);
            const call = documentScrollingElement.scrollBy.mock.calls[0];
            assert.deepStrictEqual(call.arguments[0], { behavior: "auto", top: SCROLL_STEP });
        });

        // Pressing k scrolls the document up by SCROLL_STEP pixels
        it("k scrolls up", () => {
            fireKeyDown(makeKeyEvent("KeyK"));
            assert.equal(documentScrollingElement.scrollBy.mock.callCount(), 1);
            const call = documentScrollingElement.scrollBy.mock.calls[0];
            assert.deepStrictEqual(call.arguments[0], { behavior: "auto", top: -SCROLL_STEP });
        });

        // Pressing l scrolls right by SCROLL_STEP pixels
        it("l scrolls right", () => {
            fireKeyDown(makeKeyEvent("KeyL"));
            assert.equal(documentScrollingElement.scrollBy.mock.callCount(), 1);
            const call = documentScrollingElement.scrollBy.mock.calls[0];
            assert.deepStrictEqual(call.arguments[0], { behavior: "auto", left: SCROLL_STEP });
        });

        // Pressing h scrolls left by SCROLL_STEP pixels
        it("h scrolls left", () => {
            fireKeyDown(makeKeyEvent("KeyH"));
            assert.equal(documentScrollingElement.scrollBy.mock.callCount(), 1);
            const call = documentScrollingElement.scrollBy.mock.calls[0];
            assert.deepStrictEqual(call.arguments[0], { behavior: "auto", left: -SCROLL_STEP });
        });
    });

    describe("Half-page scroll (d/u)", () => {
        // Pressing d scrolls down by half the viewport height
        it("d scrolls half page down", () => {
            fireKeyDown(makeKeyEvent("KeyD"));
            assert.equal(documentScrollingElement.scrollBy.mock.callCount(), 1);
            const call = documentScrollingElement.scrollBy.mock.calls[0];
            assert.deepStrictEqual(call.arguments[0], {
                behavior: "auto",
                top: Math.round(documentScrollingElement.clientHeight / 2),
            });
        });

        // Pressing u scrolls up by half the viewport height
        it("u scrolls half page up", () => {
            fireKeyDown(makeKeyEvent("KeyU"));
            assert.equal(documentScrollingElement.scrollBy.mock.callCount(), 1);
            const call = documentScrollingElement.scrollBy.mock.calls[0];
            assert.deepStrictEqual(call.arguments[0], {
                behavior: "auto",
                top: -Math.round(documentScrollingElement.clientHeight / 2),
            });
        });
    });

    describe("Absolute scroll (gg/G)", () => {
        // gg scrolls to the very top of the document
        it("gg scrolls to top", () => {
            fireKeyDown(makeKeyEvent("KeyG"));
            fireKeyDown(makeKeyEvent("KeyG"));
            assert.equal(documentScrollingElement.scrollTo.mock.callCount(), 1);
            const call = documentScrollingElement.scrollTo.mock.calls[0];
            assert.deepStrictEqual(call.arguments[0], { top: 0, behavior: "auto" });
        });

        // G (Shift+g) scrolls to the bottom of the document
        it("G scrolls to bottom", () => {
            fireKeyDown(makeKeyEvent("KeyG", { shift: true }));
            assert.equal(documentScrollingElement.scrollTo.mock.callCount(), 1);
            const call = documentScrollingElement.scrollTo.mock.calls[0];
            assert.deepStrictEqual(call.arguments[0], {
                top: documentScrollingElement.scrollHeight,
                behavior: "auto",
            });
        });
    });

    describe("History navigation (H/L)", () => {
        // Shift+H navigates backward in browser history
        it("H goes back", () => {
            fireKeyDown(makeKeyEvent("KeyH", { shift: true }));
            assert.equal(global.history.back.mock.callCount(), 1);
        });

        // Shift+L navigates forward in browser history
        it("L goes forward", () => {
            fireKeyDown(makeKeyEvent("KeyL", { shift: true }));
            assert.equal(global.history.forward.mock.callCount(), 1);
        });
    });

    describe("destroy()", () => {
        // After destroy, scroll commands are unregistered from KeyHandler
        it("unregisters all scroll commands", () => {
            scrollController.destroy();
            // j should no longer trigger scrollBy
            fireKeyDown(makeKeyEvent("KeyJ"));
            assert.equal(documentScrollingElement.scrollBy.mock.callCount(), 0);
        });
    });
});
