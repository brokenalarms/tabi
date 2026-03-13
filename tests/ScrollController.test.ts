// ScrollController unit tests — using Node.js built-in test runner
// Tests scroll target detection, command wiring, and scroll direction.
// Animation behavior (smoothness, deceleration) is validated visually in-browser.

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
        _style: style,
    };
}

let capturedListeners: Record<string, Function[]>,
    keyHandler: KeyHandler,
    scrollController: ScrollController;
let documentBody: ReturnType<typeof makeElement>,
    documentScrollingElement: ReturnType<typeof makeElement>;

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

    let currentTime = 0;
    (globalThis as any).performance = { now: () => currentTime };
    (globalThis as any)._setTime = (t: number) => { currentTime = t; };

    (globalThis as any).requestAnimationFrame = (cb: FrameRequestCallback) => {
        const id = ++rafIdCounter;
        rafQueue.set(id, cb);
        return id;
    };
    (globalThis as any).cancelAnimationFrame = (id: number) => {
        rafQueue.delete(id);
    };
}

// Flush rAF callbacks in 16ms steps up to targetTime.
function flushRAF(targetTime: number) {
    const step = 16;
    let time = (globalThis as any).performance.now();
    let safety = 500;
    while (rafQueue.size > 0 && safety-- > 0) {
        time += step;
        if (time > targetTime) break;
        (globalThis as any)._setTime(time);
        const batch = new Map(rafQueue);
        rafQueue.clear();
        for (const cb of batch.values()) cb(time);
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
    for (const fn of capturedListeners["keydown"] || []) fn(event);
}

function fireKeyUp(event: ReturnType<typeof makeKeyEvent>) {
    for (const fn of capturedListeners["keyup"] || []) fn(event);
}

describe("ScrollController", () => {
    beforeEach(() => loadModules());
    afterEach(() => {
        if (scrollController) scrollController.destroy();
        if (keyHandler) keyHandler.destroy();
    });

    describe("findScrollTarget", () => {
        it("returns document.scrollingElement when active element is body", () => {
            assert.strictEqual(ScrollController.findScrollTarget("y"), documentScrollingElement);
        });

        it("finds scrollable ancestor of focused element", () => {
            const scrollableDiv = makeElement({
                overflowY: "auto", scrollHeight: 2000, clientHeight: 400,
            });
            const child = makeElement({ parent: scrollableDiv });
            (globalThis as any).document.activeElement = child;
            assert.strictEqual(ScrollController.findScrollTarget("y"), scrollableDiv);
        });

        it("skips non-scrollable ancestors", () => {
            const nonScrollable = makeElement({ overflowY: "visible" });
            const child = makeElement({ parent: nonScrollable });
            nonScrollable.parentElement = documentBody;
            (globalThis as any).document.activeElement = child;
            assert.strictEqual(ScrollController.findScrollTarget("y"), documentScrollingElement);
        });

        it("detects horizontal scrollability", () => {
            const hScroll = makeElement({
                overflowX: "scroll", scrollWidth: 2000, clientWidth: 400,
            });
            const child = makeElement({ parent: hScroll });
            (globalThis as any).document.activeElement = child;
            assert.strictEqual(ScrollController.findScrollTarget("x"), hScroll);
        });
    });

    describe("Scroll commands (j/k/h/l)", () => {
        it("j starts scrolling down", () => {
            fireKeyDown(makeKeyEvent("KeyJ"));
            flushRAF(200);
            assert.ok(documentScrollingElement.scrollTop > 0, "should scroll down");
        });

        it("k starts scrolling up", () => {
            documentScrollingElement.scrollTop = 500;
            fireKeyDown(makeKeyEvent("KeyK"));
            flushRAF(200);
            assert.ok(documentScrollingElement.scrollTop < 500, "should scroll up");
        });

        it("l starts scrolling right", () => {
            fireKeyDown(makeKeyEvent("KeyL"));
            flushRAF(200);
            assert.ok(documentScrollingElement.scrollLeft > 0, "should scroll right");
        });

        it("h starts scrolling left", () => {
            documentScrollingElement.scrollLeft = 500;
            fireKeyDown(makeKeyEvent("KeyH"));
            flushRAF(200);
            assert.ok(documentScrollingElement.scrollLeft < 500, "should scroll left");
        });
    });

    describe("Half-page scroll (d/u)", () => {
        it("d scrolls half page down", () => {
            fireKeyDown(makeKeyEvent("KeyD"));
            flushRAF(5000);
            assert.equal(
                documentScrollingElement.scrollTop,
                Math.round(documentScrollingElement.clientHeight / 2),
            );
        });

        it("u scrolls half page up", () => {
            documentScrollingElement.scrollTop = 1000;
            fireKeyDown(makeKeyEvent("KeyU"));
            flushRAF(5000);
            assert.equal(
                documentScrollingElement.scrollTop,
                1000 - Math.round(documentScrollingElement.clientHeight / 2),
            );
        });
    });

    describe("Absolute scroll (gg/G)", () => {
        it("gg scrolls to top", () => {
            documentScrollingElement.scrollTop = 500;
            fireKeyDown(makeKeyEvent("KeyG"));
            fireKeyDown(makeKeyEvent("KeyG"));
            flushRAF(5000);
            assert.equal(documentScrollingElement.scrollTop, 0);
        });

        it("G scrolls to bottom", () => {
            documentScrollingElement.scrollTop = 0;
            fireKeyDown(makeKeyEvent("KeyG", { shift: true }));
            flushRAF(5000);
            assert.equal(
                documentScrollingElement.scrollTop,
                documentScrollingElement.scrollHeight - documentScrollingElement.clientHeight,
            );
        });
    });

    describe("History navigation (H/L)", () => {
        it("H goes back", () => {
            fireKeyDown(makeKeyEvent("KeyH", { shift: true }));
            assert.equal((globalThis as any).history.back.mock.callCount(), 1);
        });

        it("L goes forward", () => {
            fireKeyDown(makeKeyEvent("KeyL", { shift: true }));
            assert.equal((globalThis as any).history.forward.mock.callCount(), 1);
        });
    });

    describe("Page refresh (r)", () => {
        it("r refreshes the page", () => {
            fireKeyDown(makeKeyEvent("KeyR"));
            assert.equal((globalThis as any).location.reload.mock.callCount(), 1);
        });
    });

    describe("destroy()", () => {
        it("unregisters all scroll commands", () => {
            scrollController.destroy();
            fireKeyDown(makeKeyEvent("KeyJ"));
            flushRAF(200);
            assert.equal(documentScrollingElement.scrollTop, 0);
        });
    });
});
