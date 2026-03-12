// FindMode unit tests — using Node.js built-in test runner
// FindMode is a thin wrapper that dispatches Cmd+F to trigger Safari's
// native find bar. Tests verify command wiring, lifecycle, and cleanup.

const { describe, it, beforeEach, afterEach, mock } = require("node:test");
const assert = require("node:assert/strict");

// --- Minimal DOM shim ---

let capturedListeners, keyHandler, findMode;
let bodyEl;
let dispatchedEvents;

function makeElement(tag, opts = {}) {
    return {
        tagName: tag,
        type: opts.type || "",
        isContentEditable: false,
        className: "",
        placeholder: "",
        value: opts.value || "",
        parentNode: opts.parentNode || bodyEl,
        style: {},
        _children: [],
        _listeners: {},
        focus: mock.fn(),
        blur: mock.fn(),
        click: mock.fn(),
        select: mock.fn(),
        setAttribute(k, v) { this["_attr_" + k] = v; },
        appendChild(child) { child.parentNode = this; this._children.push(child); return child; },
        removeChild(child) {
            const idx = this._children.indexOf(child);
            if (idx >= 0) this._children.splice(idx, 1);
            child.parentNode = null;
            return child;
        },
        addEventListener(type, fn) { this._listeners[type] = fn; },
        removeEventListener(type, fn) { delete this._listeners[type]; },
    };
}

function setupDOM() {
    capturedListeners = {};
    dispatchedEvents = [];

    bodyEl = makeElement("BODY");
    bodyEl.parentNode = null;

    globalThis.document = {
        body: bodyEl,
        head: makeElement("HEAD"),
        documentElement: makeElement("HTML"),
        activeElement: bodyEl,
        createElement(tag) {
            return makeElement(tag.toUpperCase());
        },
        addEventListener(type, fn, opts) {
            capturedListeners[type] = fn;
        },
        removeEventListener(type, fn, opts) {
            if (capturedListeners[type] === fn) delete capturedListeners[type];
        },
        querySelectorAll() { return []; },
        dispatchEvent(event) {
            dispatchedEvents.push(event);
        },
    };

    globalThis.window = {
        innerWidth: 1024,
        innerHeight: 768,
        find() { return true; },
        getSelection() { return { removeAllRanges() {} }; },
    };

    globalThis.KeyboardEvent = class KeyboardEvent {
        constructor(type, init = {}) {
            this.type = type;
            this.key = init.key || "";
            this.code = init.code || "";
            this.metaKey = init.metaKey || false;
            this.bubbles = init.bubbles || false;
            this.cancelable = init.cancelable || false;
        }
    };

    globalThis.getComputedStyle = () => ({
        visibility: "visible",
        display: "block",
        opacity: "1",
        cursor: "default",
    });
}

function teardownDOM() {
    delete globalThis.document;
    delete globalThis.window;
    delete globalThis.KeyboardEvent;
    delete globalThis.getComputedStyle;
}

function fireKeyDown(code, opts = {}) {
    const event = {
        code,
        key: opts.key || "",
        shiftKey: opts.shiftKey || false,
        ctrlKey: opts.ctrlKey || false,
        altKey: opts.altKey || false,
        metaKey: opts.metaKey || false,
        _prevented: false,
        _stopped: false,
        preventDefault() { this._prevented = true; },
        stopPropagation() { this._stopped = true; },
    };
    if (capturedListeners.keydown) {
        capturedListeners.keydown(event);
    }
    return event;
}

// --- Load modules ---

require("../Vimium/Safari Extension/Resources/commands.js");
require("../Vimium/Safari Extension/Resources/modules/KeyHandler.js");
require("../Vimium/Safari Extension/Resources/modules/FindMode.js");

// --- Tests ---

describe("FindMode", () => {
    beforeEach(() => {
        setupDOM();
        dispatchedEvents = [];
        keyHandler = new KeyHandler();
        findMode = new FindMode(keyHandler);
    });

    afterEach(() => {
        if (findMode) findMode.destroy();
        if (keyHandler) keyHandler.destroy();
        teardownDOM();
    });

    describe("native find dispatch", () => {
        it("dispatches Cmd+F KeyboardEvent on enterFindMode", () => {
            keyHandler._dispatch("enterFindMode");
            assert.equal(dispatchedEvents.length, 1);
            const evt = dispatchedEvents[0];
            assert.equal(evt.type, "keydown");
            assert.equal(evt.key, "f");
            assert.equal(evt.code, "KeyF");
            assert.equal(evt.metaKey, true);
            assert.equal(evt.bubbles, true);
        });

        it("dispatches on repeated invocations", () => {
            keyHandler._dispatch("enterFindMode");
            keyHandler._dispatch("enterFindMode");
            assert.equal(dispatchedEvents.length, 2);
        });
    });

    describe("isActive", () => {
        it("always returns false (native find manages lifecycle)", () => {
            assert.equal(findMode.isActive(), false);
        });
    });

    describe("deactivate", () => {
        it("is a no-op and does not throw", () => {
            assert.doesNotThrow(() => findMode.deactivate(true));
            assert.doesNotThrow(() => findMode.deactivate(false));
        });
    });

    describe("destroy", () => {
        it("unwires enterFindMode command", () => {
            findMode.destroy();
            // After destroy, enterFindMode should not dispatch
            keyHandler._dispatch("enterFindMode");
            assert.equal(dispatchedEvents.length, 0);
        });

        it("can be called multiple times without error", () => {
            assert.doesNotThrow(() => {
                findMode.destroy();
                findMode.destroy();
            });
        });
    });
});
