// ScrollController unit tests — using Node.js built-in test runner
// Tests scroll target detection, directional scrolling, half-page scrolling,
// absolute scrolling, and history navigation command wiring.
// The smooth-scroll implementation uses requestAnimationFrame; these tests
// simulate the animation by flushing rAF callbacks to their final frame.

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
        scrollHeight: opts.scrollHeight || 5000,
        clientWidth: opts.clientWidth || 100,
        clientHeight: opts.clientHeight || 600,
        scrollLeft: opts.scrollLeft || 0,
        scrollTop: opts.scrollTop || 0,
        parentElement: opts.parent || null,
        scrollBy: mock.fn(),
        scrollTo: mock.fn(),
        _style: style,
    };
}

let capturedListeners, keyHandler, scrollController;
let documentBody, documentScrollingElement;

// rAF simulation: collect callbacks and flush them with a given timestamp.
let rafQueue;
let rafIdCounter;

function setupDOM() {
    capturedListeners = {};
    rafQueue = new Map();
    rafIdCounter = 0;

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
    global.location = { reload: mock.fn() };
    global.clearTimeout = clearTimeout;
    global.setTimeout = setTimeout;

    // performance.now shim
    global.performance = { now: () => 0 };

    // requestAnimationFrame / cancelAnimationFrame shim
    global.requestAnimationFrame = (cb) => {
        const id = ++rafIdCounter;
        rafQueue.set(id, cb);
        return id;
    };
    global.cancelAnimationFrame = (id) => {
        rafQueue.delete(id);
    };
}

// Flush all pending rAF callbacks, simulating time jumping to `timestamp`.
// Repeats until no new callbacks are queued (handles chained rAFs).
function flushRAF(timestamp) {
    let safety = 100;
    while (rafQueue.size > 0 && safety-- > 0) {
        const batch = new Map(rafQueue);
        rafQueue.clear();
        for (const cb of batch.values()) {
            cb(timestamp);
        }
    }
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
        // Pressing j smooth-scrolls the document down by SCROLL_STEP pixels
        it("j scrolls down", () => {
            fireKeyDown(makeKeyEvent("KeyJ"));
            // Flush animation to completion (timestamp well past duration)
            flushRAF(1000);
            assert.equal(documentScrollingElement.scrollTop, SCROLL_STEP);
            assert.equal(documentScrollingElement.scrollLeft, 0);
        });

        // Pressing k smooth-scrolls the document up by SCROLL_STEP pixels
        it("k scrolls up", () => {
            documentScrollingElement.scrollTop = 200;
            fireKeyDown(makeKeyEvent("KeyK"));
            flushRAF(1000);
            assert.equal(documentScrollingElement.scrollTop, 200 - SCROLL_STEP);
        });

        // Pressing l smooth-scrolls right by SCROLL_STEP pixels
        it("l scrolls right", () => {
            fireKeyDown(makeKeyEvent("KeyL"));
            flushRAF(1000);
            assert.equal(documentScrollingElement.scrollLeft, SCROLL_STEP);
        });

        // Pressing h smooth-scrolls left by SCROLL_STEP pixels
        it("h scrolls left", () => {
            documentScrollingElement.scrollLeft = 200;
            fireKeyDown(makeKeyEvent("KeyH"));
            flushRAF(1000);
            assert.equal(documentScrollingElement.scrollLeft, 200 - SCROLL_STEP);
        });
    });

    describe("Half-page scroll (d/u)", () => {
        // Pressing d smooth-scrolls down by half the viewport height
        it("d scrolls half page down", () => {
            fireKeyDown(makeKeyEvent("KeyD"));
            flushRAF(1000);
            assert.equal(
                documentScrollingElement.scrollTop,
                Math.round(documentScrollingElement.clientHeight / 2),
            );
        });

        // Pressing u smooth-scrolls up by half the viewport height
        it("u scrolls half page up", () => {
            documentScrollingElement.scrollTop = 1000;
            fireKeyDown(makeKeyEvent("KeyU"));
            flushRAF(1000);
            assert.equal(
                documentScrollingElement.scrollTop,
                1000 - Math.round(documentScrollingElement.clientHeight / 2),
            );
        });
    });

    describe("Absolute scroll (gg/G)", () => {
        // gg smooth-scrolls to the very top of the document
        it("gg scrolls to top", () => {
            documentScrollingElement.scrollTop = 500;
            fireKeyDown(makeKeyEvent("KeyG"));
            fireKeyDown(makeKeyEvent("KeyG"));
            flushRAF(1000);
            assert.equal(documentScrollingElement.scrollTop, 0);
        });

        // G (Shift+g) smooth-scrolls to the bottom of the document
        it("G scrolls to bottom", () => {
            documentScrollingElement.scrollTop = 0;
            fireKeyDown(makeKeyEvent("KeyG", { shift: true }));
            flushRAF(1000);
            assert.equal(
                documentScrollingElement.scrollTop,
                documentScrollingElement.scrollHeight - documentScrollingElement.clientHeight,
            );
        });
    });

    describe("Smooth scroll animation", () => {
        // Mid-animation the scroll position should be partially advanced
        it("intermediate frame produces partial scroll", () => {
            fireKeyDown(makeKeyEvent("KeyJ"));
            // Flush at half the duration (75ms) — easeOut(0.5) = 0.75
            flushRAF(75);
            const expected = SCROLL_STEP * 0.75;
            assert.ok(
                Math.abs(documentScrollingElement.scrollTop - expected) < 1,
                `expected ~${expected}, got ${documentScrollingElement.scrollTop}`,
            );
        });

        // Rapid repeated keys cancel the previous animation and start fresh
        it("cancels previous animation on same element", () => {
            fireKeyDown(makeKeyEvent("KeyJ"));
            // Don't flush — immediately press j again
            documentScrollingElement.scrollTop = 30; // simulate partial progress
            fireKeyDown(makeKeyEvent("KeyJ"));
            flushRAF(1000);
            // Should have scrolled SCROLL_STEP from the position at the time of the second press (30)
            assert.equal(documentScrollingElement.scrollTop, 30 + SCROLL_STEP);
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

    describe("Page refresh (r)", () => {
        // Pressing r reloads the current page
        it("r refreshes the page", () => {
            fireKeyDown(makeKeyEvent("KeyR"));
            assert.equal(global.location.reload.mock.callCount(), 1);
        });
    });

    describe("destroy()", () => {
        // After destroy, scroll commands are unregistered from KeyHandler
        it("unregisters all scroll commands", () => {
            scrollController.destroy();
            // j should no longer trigger scrolling
            fireKeyDown(makeKeyEvent("KeyJ"));
            flushRAF(1000);
            assert.equal(documentScrollingElement.scrollTop, 0);
        });
    });
});
