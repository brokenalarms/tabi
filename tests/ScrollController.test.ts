// ScrollController unit tests — using Node.js built-in test runner
// Tests scroll target detection, directional scrolling, half-page scrolling,
// absolute scrolling, and history navigation command wiring.
// The smooth-scroll implementation uses requestAnimationFrame; these tests
// simulate the animation by flushing rAF callbacks to their final frame.

import { describe, it, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { KeyHandler } from "../src/modules/KeyHandler";
import { ScrollController, ScrollConfig } from "../src/modules/ScrollController";

// --- Minimal DOM shim ---

function makeElement(opts: Record<string, any> = {}) {
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

let capturedListeners: Record<string, Function[]>,
    keyHandler: KeyHandler,
    scrollController: ScrollController;
let documentBody: ReturnType<typeof makeElement>,
    documentScrollingElement: ReturnType<typeof makeElement>;

// rAF simulation: collect callbacks and flush them with a given timestamp.
let rafQueue: Map<number, FrameRequestCallback>;
let rafIdCounter: number;

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

    (globalThis as any).document = {
        addEventListener(type: string, fn: Function, capture?: boolean) {
            if (!capturedListeners[type]) capturedListeners[type] = [];
            capturedListeners[type].push(fn);
        },
        removeEventListener(type: string, fn: Function, capture?: boolean) {
            if (capturedListeners[type]) {
                capturedListeners[type] = capturedListeners[type].filter((f) => f !== fn);
            }
        },
        activeElement: documentBody,
        body: documentBody,
        documentElement: documentScrollingElement,
        scrollingElement: documentScrollingElement,
    };

    (globalThis as any).getComputedStyle = (el: any) => el._style;
    (globalThis as any).history = { back: mock.fn(), forward: mock.fn() };
    (globalThis as any).location = { reload: mock.fn() };
    (globalThis as any).clearTimeout = clearTimeout;
    (globalThis as any).setTimeout = setTimeout;

    // performance.now shim
    (globalThis as any).performance = { now: () => 0 };

    // requestAnimationFrame / cancelAnimationFrame shim
    (globalThis as any).requestAnimationFrame = (cb: FrameRequestCallback) => {
        const id = ++rafIdCounter;
        rafQueue.set(id, cb);
        return id;
    };
    (globalThis as any).cancelAnimationFrame = (id: number) => {
        rafQueue.delete(id);
    };
}

// Flush all pending rAF callbacks, simulating time jumping to `timestamp`.
// Repeats until no new callbacks are queued (handles chained rAFs).
function flushRAF(timestamp: number) {
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
    keyHandler = new KeyHandler();
    scrollController = new ScrollController(keyHandler);
}

function makeKeyEvent(code: string, opts: Record<string, boolean> = {}) {
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

function fireKeyDown(event: ReturnType<typeof makeKeyEvent>) {
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
            (globalThis as any).document.activeElement = child;

            const target = ScrollController.findScrollTarget("y");
            assert.strictEqual(target, scrollableDiv);
        });

        // Falls through non-scrollable ancestors to document.scrollingElement
        it("skips non-scrollable ancestors", () => {
            const nonScrollable = makeElement({ overflowY: "visible" });
            const child = makeElement({ parent: nonScrollable });
            nonScrollable.parentElement = documentBody;
            (globalThis as any).document.activeElement = child;

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
            (globalThis as any).document.activeElement = child;

            const target = ScrollController.findScrollTarget("x");
            assert.strictEqual(target, hScroll);
        });
    });

    describe("Step scroll (j/k/h/l)", () => {
        // Pressing j smooth-scrolls the document down by ScrollConfig.scrollStep pixels
        it("j scrolls down", () => {
            fireKeyDown(makeKeyEvent("KeyJ"));
            // Flush animation to completion (timestamp well past duration)
            flushRAF(1000);
            assert.equal(documentScrollingElement.scrollTop, ScrollConfig.scrollStep);
            assert.equal(documentScrollingElement.scrollLeft, 0);
        });

        // Pressing k smooth-scrolls the document up by ScrollConfig.scrollStep pixels
        it("k scrolls up", () => {
            documentScrollingElement.scrollTop = 200;
            fireKeyDown(makeKeyEvent("KeyK"));
            flushRAF(1000);
            assert.equal(documentScrollingElement.scrollTop, 200 - ScrollConfig.scrollStep);
        });

        // Pressing l smooth-scrolls right by ScrollConfig.scrollStep pixels
        it("l scrolls right", () => {
            fireKeyDown(makeKeyEvent("KeyL"));
            flushRAF(1000);
            assert.equal(documentScrollingElement.scrollLeft, ScrollConfig.scrollStep);
        });

        // Pressing h smooth-scrolls left by ScrollConfig.scrollStep pixels
        it("h scrolls left", () => {
            documentScrollingElement.scrollLeft = 200;
            fireKeyDown(makeKeyEvent("KeyH"));
            flushRAF(1000);
            assert.equal(documentScrollingElement.scrollLeft, 200 - ScrollConfig.scrollStep);
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
            const expected = ScrollConfig.scrollStep * 0.75;
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
            // Should have scrolled ScrollConfig.scrollStep from the position at the time of the second press (30)
            assert.equal(documentScrollingElement.scrollTop, 30 + ScrollConfig.scrollStep);
        });
    });

    describe("History navigation (H/L)", () => {
        // Shift+H navigates backward in browser history
        it("H goes back", () => {
            fireKeyDown(makeKeyEvent("KeyH", { shift: true }));
            assert.equal((globalThis as any).history.back.mock.callCount(), 1);
        });

        // Shift+L navigates forward in browser history
        it("L goes forward", () => {
            fireKeyDown(makeKeyEvent("KeyL", { shift: true }));
            assert.equal((globalThis as any).history.forward.mock.callCount(), 1);
        });
    });

    describe("Page refresh (r)", () => {
        // Pressing r reloads the current page
        it("r refreshes the page", () => {
            fireKeyDown(makeKeyEvent("KeyR"));
            assert.equal((globalThis as any).location.reload.mock.callCount(), 1);
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
