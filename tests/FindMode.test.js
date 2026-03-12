// FindMode unit tests — using Node.js built-in test runner
// Tests smartcase detection, find bar lifecycle, search invocation,
// n/N navigation, Enter to close on match, Escape to close and clear.

const { describe, it, beforeEach, afterEach, mock } = require("node:test");
const assert = require("node:assert/strict");

// --- Minimal DOM shim ---

let capturedListeners, keyHandler, findMode;
let bodyEl, headEl, selectionObj;
let lastWindowFind;

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
    lastWindowFind = { calls: [] };

    bodyEl = makeElement("BODY");
    bodyEl.parentNode = null;
    headEl = makeElement("HEAD");

    selectionObj = {
        removeAllRanges: mock.fn(),
    };

    globalThis.document = {
        body: bodyEl,
        head: headEl,
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
    };

    globalThis.window = {
        innerWidth: 1024,
        innerHeight: 768,
        find(query, caseSensitive, backward, wrapAround) {
            lastWindowFind.calls.push({ query, caseSensitive, backward, wrapAround });
            // Return true unless query is "notfound"
            return query !== "notfound";
        },
        getSelection() { return selectionObj; },
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

require("../Vimium/Safari Extension/Resources/modules/KeyHandler.js");
require("../Vimium/Safari Extension/Resources/modules/FindMode.js");

// --- Tests ---

describe("FindMode", () => {
    beforeEach(() => {
        setupDOM();
        keyHandler = new KeyHandler();
        findMode = new FindMode(keyHandler);
        keyHandler.on("exitToNormal", () => {
            if (findMode.isActive()) findMode.deactivate(true);
            keyHandler.setMode(Mode.NORMAL);
        });
    });

    afterEach(() => {
        if (findMode) findMode.destroy();
        if (keyHandler) keyHandler.destroy();
        teardownDOM();
    });

    describe("smartcase detection", () => {
        // Verifies that all-lowercase queries trigger case-insensitive search
        it("treats all-lowercase as case-insensitive", () => {
            assert.equal(FindMode.isSmartCaseSensitive("hello"), false);
        });

        // Verifies that mixed-case queries trigger case-sensitive search
        it("treats mixed-case as case-sensitive", () => {
            assert.equal(FindMode.isSmartCaseSensitive("Hello"), true);
        });

        // Verifies that queries with only uppercase are case-sensitive
        it("treats all-uppercase as case-sensitive", () => {
            assert.equal(FindMode.isSmartCaseSensitive("HELLO"), true);
        });

        // Verifies that queries with numbers but no uppercase stay insensitive
        it("treats lowercase with numbers as case-insensitive", () => {
            assert.equal(FindMode.isSmartCaseSensitive("test123"), false);
        });
    });

    describe("activation and deactivation", () => {
        // Verifies that activating creates the find bar UI and enters FIND mode
        it("creates find bar on activate and sets FIND mode", () => {
            findMode.activate();
            assert.equal(findMode.isActive(), true);
            assert.equal(keyHandler.getMode(), Mode.FIND);
            // Bar should be appended to body
            assert.equal(bodyEl._children.length, 1);
            assert.equal(bodyEl._children[0].className, "vimium-find-bar");
        });

        // Verifies that deactivation removes the find bar and returns to NORMAL
        it("removes find bar on deactivate and returns to NORMAL", () => {
            findMode.activate();
            findMode.deactivate(false);
            assert.equal(findMode.isActive(), false);
            assert.equal(keyHandler.getMode(), Mode.NORMAL);
            assert.equal(bodyEl._children.length, 0);
        });

        // Verifies that double-activate is idempotent
        it("ignores double activate", () => {
            findMode.activate();
            findMode.activate();
            assert.equal(bodyEl._children.length, 1);
        });
    });

    describe("Escape key", () => {
        // Verifies that Escape closes find bar and clears the last query
        it("closes find bar and clears query on Escape", () => {
            findMode.activate();
            findMode._lastQuery = "test";
            fireKeyDown("Escape");
            assert.equal(findMode.isActive(), false);
            assert.equal(findMode.getLastQuery(), "");
        });
    });

    describe("Enter key", () => {
        // Verifies that Enter closes the find bar but preserves the match
        it("closes find bar but preserves query on Enter", () => {
            findMode.activate();
            findMode._lastQuery = "hello";
            findMode._inputEl.value = "hello";
            fireKeyDown("Enter");
            assert.equal(findMode.isActive(), false);
            assert.equal(findMode.getLastQuery(), "hello");
        });

        // Verifies that Shift+Enter finds previous match without closing
        it("finds previous match on Shift+Enter", () => {
            findMode.activate();
            findMode._lastQuery = "hello";
            findMode._inputEl.value = "hello";
            const before = lastWindowFind.calls.length;
            fireKeyDown("Enter", { shiftKey: true });
            // Should still be active (Shift+Enter doesn't close)
            assert.equal(findMode.isActive(), true);
            // Should have called findPrev
            const call = lastWindowFind.calls[lastWindowFind.calls.length - 1];
            assert.equal(call.backward, true);
        });
    });

    describe("search via input", () => {
        // Verifies that typing in the input triggers window.find
        it("calls window.find on input change", () => {
            findMode.activate();
            findMode._inputEl.value = "searchterm";
            // Simulate input event
            findMode._inputEl._listeners.input();
            const call = lastWindowFind.calls[lastWindowFind.calls.length - 1];
            assert.equal(call.query, "searchterm");
            assert.equal(call.caseSensitive, false);
            assert.equal(call.backward, false);
            assert.equal(call.wrapAround, true);
        });

        // Verifies smartcase integration — uppercase triggers case-sensitive
        it("passes caseSensitive=true for mixed-case query", () => {
            findMode.activate();
            findMode._inputEl.value = "SearchTerm";
            findMode._inputEl._listeners.input();
            const call = lastWindowFind.calls[lastWindowFind.calls.length - 1];
            assert.equal(call.caseSensitive, true);
        });

        // Verifies that "no matches" text shows for unfound queries
        it("shows 'No matches' for unfound query", () => {
            findMode.activate();
            findMode._inputEl.value = "notfound";
            findMode._inputEl._listeners.input();
            assert.equal(findMode._countEl.textContent, "No matches");
        });
    });

    describe("findNext / findPrev from NORMAL mode", () => {
        // Verifies that n repeats the last search forward
        it("n repeats the last search forward", () => {
            findMode._lastQuery = "test";
            findMode._caseSensitive = false;
            findMode._findNext();
            const call = lastWindowFind.calls[lastWindowFind.calls.length - 1];
            assert.equal(call.query, "test");
            assert.equal(call.backward, false);
        });

        // Verifies that N repeats the last search backward
        it("N repeats the last search backward", () => {
            findMode._lastQuery = "test";
            findMode._caseSensitive = false;
            findMode._findPrev();
            const call = lastWindowFind.calls[lastWindowFind.calls.length - 1];
            assert.equal(call.query, "test");
            assert.equal(call.backward, true);
        });

        // Verifies that findNext with no prior query does nothing
        it("does nothing with no prior query", () => {
            const before = lastWindowFind.calls.length;
            findMode._findNext();
            assert.equal(lastWindowFind.calls.length, before);
        });
    });

    describe("last query preservation", () => {
        // Verifies that reopening find bar pre-fills the last query
        it("pre-fills input with last query on reactivation", () => {
            findMode.activate();
            findMode._inputEl.value = "previous";
            findMode._lastQuery = "previous";
            findMode.deactivate(false);

            findMode.activate();
            assert.equal(findMode._inputEl.value, "previous");
        });

        // Verifies that Escape clears the last query for fresh start
        it("clears last query after Escape", () => {
            findMode.activate();
            findMode._lastQuery = "cleared";
            findMode._inputEl.value = "cleared";
            fireKeyDown("Escape");

            assert.equal(findMode.getLastQuery(), "");
        });
    });

    describe("command wiring", () => {
        // Verifies that enterFindMode command activates find mode
        it("enterFindMode command activates", () => {
            keyHandler._dispatch("enterFindMode");
            assert.equal(findMode.isActive(), true);
        });

        // Verifies that destroy unwires commands
        it("destroy unwires commands", () => {
            findMode.destroy();
            // After destroy, enterFindMode should be a no-op
            keyHandler._dispatch("enterFindMode");
            assert.equal(findMode.isActive(), false);
        });
    });

    describe("key event isolation", () => {
        // Verifies that non-special keys are stopped from propagating to KeyHandler
        it("stops propagation for regular keys in find mode", () => {
            findMode.activate();
            const event = fireKeyDown("KeyA", { key: "a" });
            assert.equal(event._stopped, true);
        });

        // Verifies Escape prevents default
        it("prevents default for Escape", () => {
            findMode.activate();
            const event = fireKeyDown("Escape");
            assert.equal(event._prevented, true);
        });
    });
});
