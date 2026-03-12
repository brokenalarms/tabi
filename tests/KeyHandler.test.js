// KeyHandler unit tests — using Node.js built-in test runner
// Tests the mode state machine, key sequence parser with timeout,
// input field detection, and command dispatch.

const { describe, it, beforeEach, afterEach, mock } = require("node:test");
const assert = require("node:assert/strict");

// --- Minimal DOM shim for Node.js ---

class FakeElement {
    constructor(tag, attrs = {}) {
        this.tagName = tag;
        this.type = attrs.type || "";
        this.isContentEditable = attrs.contentEditable || false;
    }
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

// Shim globals before loading KeyHandler
let capturedListeners = {};
let keyHandler;

function setupDOM() {
    capturedListeners = {};
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
        activeElement: new FakeElement("BODY"),
        body: new FakeElement("BODY"),
    };
    global.clearTimeout = clearTimeout;
    global.setTimeout = setTimeout;
}

function fireKeyDown(event) {
    const listeners = capturedListeners["keydown"] || [];
    for (const fn of listeners) fn(event);
}

function fireFocusIn(target) {
    const listeners = capturedListeners["focusin"] || [];
    for (const fn of listeners) fn({ target });
}

function fireFocusOut(target) {
    const listeners = capturedListeners["focusout"] || [];
    for (const fn of listeners) fn({ target });
}

// Load the module source (not an ES module — defines globals)
function loadKeyHandler() {
    setupDOM();
    // Clear require cache so each test gets a fresh module
    const modulePath = require("node:path").resolve(
        __dirname,
        "../Vimium/Safari Extension/Resources/modules/KeyHandler.js"
    );
    delete require.cache[modulePath];
    require(modulePath);
    keyHandler = new global.KeyHandler();
}

describe("KeyHandler", () => {
    beforeEach(() => {
        loadKeyHandler();
    });

    afterEach(() => {
        if (keyHandler) keyHandler.destroy();
    });

    describe("Mode state machine", () => {
        // Verifies initial mode and transitions between all five modes
        it("starts in NORMAL mode", () => {
            assert.equal(keyHandler.getMode(), "NORMAL");
        });

        it("transitions between modes and fires listeners", () => {
            const transitions = [];
            keyHandler.onModeChange((to, from) => transitions.push({ to, from }));

            keyHandler.setMode(Mode.INSERT);
            assert.equal(keyHandler.getMode(), "INSERT");

            keyHandler.setMode(Mode.HINTS);
            assert.equal(keyHandler.getMode(), "HINTS");

            keyHandler.setMode(Mode.FIND);
            assert.equal(keyHandler.getMode(), "FIND");

            keyHandler.setMode(Mode.TAB_SEARCH);
            assert.equal(keyHandler.getMode(), "TAB_SEARCH");

            keyHandler.setMode(Mode.NORMAL);
            assert.equal(keyHandler.getMode(), "NORMAL");

            assert.equal(transitions.length, 5);
            assert.equal(transitions[0].from, "NORMAL");
            assert.equal(transitions[0].to, "INSERT");
        });

        // Setting the same mode is a no-op
        it("does not fire listener for same-mode transition", () => {
            const transitions = [];
            keyHandler.onModeChange((to) => transitions.push(to));
            keyHandler.setMode(Mode.NORMAL);
            assert.equal(transitions.length, 0);
        });
    });

    describe("Key normalization", () => {
        // Verifies event.code-based key identity with modifier encoding
        it("normalizes plain key", () => {
            assert.equal(KeyHandler.normalizeKey(makeKeyEvent("KeyJ")), "KeyJ");
        });

        it("normalizes shift modifier", () => {
            assert.equal(
                KeyHandler.normalizeKey(makeKeyEvent("KeyG", { shift: true })),
                "Shift-KeyG"
            );
        });

        it("normalizes multiple modifiers", () => {
            assert.equal(
                KeyHandler.normalizeKey(makeKeyEvent("KeyA", { ctrl: true, shift: true })),
                "Ctrl-Shift-KeyA"
            );
        });
    });

    describe("Single-key command dispatch", () => {
        // Tests that pressing 'j' in NORMAL mode dispatches scrollDown
        it("dispatches single-key binding", () => {
            let called = false;
            keyHandler.on("scrollDown", () => { called = true; });
            const ev = makeKeyEvent("KeyJ");
            fireKeyDown(ev);
            assert.ok(called, "scrollDown should be called");
            assert.equal(ev.preventDefault.mock.callCount(), 1);
        });

        // Tests that shift+key dispatches a different command (G → scrollToBottom)
        it("dispatches shift-modified binding", () => {
            let called = false;
            keyHandler.on("scrollToBottom", () => { called = true; });
            fireKeyDown(makeKeyEvent("KeyG", { shift: true }));
            assert.ok(called);
        });

        // Tests that unbound keys pass through without being consumed
        it("ignores unbound keys", () => {
            const ev = makeKeyEvent("KeyZ");
            fireKeyDown(ev);
            assert.equal(ev.preventDefault.mock.callCount(), 0);
        });
    });

    describe("Multi-key sequence with timeout", () => {
        // Tests that 'g' followed by 'g' dispatches scrollToTop
        it("dispatches gg sequence", () => {
            let called = false;
            keyHandler.on("scrollToTop", () => { called = true; });
            fireKeyDown(makeKeyEvent("KeyG"));
            fireKeyDown(makeKeyEvent("KeyG"));
            assert.ok(called, "scrollToTop should be called for gg");
        });

        // Tests that g+t dispatches tabNext
        it("dispatches gt sequence", () => {
            let called = false;
            keyHandler.on("tabNext", () => { called = true; });
            fireKeyDown(makeKeyEvent("KeyG"));
            fireKeyDown(makeKeyEvent("KeyT"));
            assert.ok(called);
        });

        // Tests that g+Shift+T dispatches tabPrev
        it("dispatches gT (g + Shift-T) sequence", () => {
            let called = false;
            keyHandler.on("tabPrev", () => { called = true; });
            fireKeyDown(makeKeyEvent("KeyG"));
            fireKeyDown(makeKeyEvent("KeyT", { shift: true }));
            assert.ok(called);
        });

        // Tests that g+0 dispatches firstTab
        it("dispatches g0 sequence", () => {
            let called = false;
            keyHandler.on("firstTab", () => { called = true; });
            fireKeyDown(makeKeyEvent("KeyG"));
            fireKeyDown(makeKeyEvent("Digit0"));
            assert.ok(called);
        });

        // Tests that g+$ (Shift-4) dispatches lastTab
        it("dispatches g$ sequence", () => {
            let called = false;
            keyHandler.on("lastTab", () => { called = true; });
            fireKeyDown(makeKeyEvent("KeyG"));
            fireKeyDown(makeKeyEvent("Digit4", { shift: true }));
            assert.ok(called);
        });

        // Tests that incomplete prefix times out and buffer resets
        it("resets buffer after timeout", async () => {
            let called = false;
            keyHandler.on("scrollToTop", () => { called = true; });
            fireKeyDown(makeKeyEvent("KeyG"));
            await new Promise((r) => setTimeout(r, 600));
            fireKeyDown(makeKeyEvent("KeyG"));
            // Second 'g' alone is a new prefix, not gg completion
            assert.ok(!called, "scrollToTop should NOT be called after timeout");
        });

        // Tests that prefix key suppresses browser default
        it("suppresses prefix key", () => {
            const ev = makeKeyEvent("KeyG");
            fireKeyDown(ev);
            assert.equal(ev.preventDefault.mock.callCount(), 1);
        });
    });

    describe("Input field detection and auto-INSERT mode", () => {
        // Verifies that focusing a text input switches to INSERT mode
        it("enters INSERT mode on text input focus", () => {
            const input = new FakeElement("INPUT", { type: "text" });
            fireFocusIn(input);
            assert.equal(keyHandler.getMode(), "INSERT");
        });

        // Verifies that leaving input switches back to NORMAL
        it("exits INSERT mode on input blur", () => {
            const input = new FakeElement("INPUT", { type: "text" });
            fireFocusIn(input);
            assert.equal(keyHandler.getMode(), "INSERT");
            fireFocusOut(input);
            assert.equal(keyHandler.getMode(), "NORMAL");
        });

        // Verifies that textarea also triggers INSERT mode
        it("enters INSERT mode on textarea focus", () => {
            const textarea = new FakeElement("TEXTAREA");
            fireFocusIn(textarea);
            assert.equal(keyHandler.getMode(), "INSERT");
        });

        // Verifies that contentEditable elements trigger INSERT mode
        it("enters INSERT mode on contentEditable focus", () => {
            const div = new FakeElement("DIV", { contentEditable: true });
            fireFocusIn(div);
            assert.equal(keyHandler.getMode(), "INSERT");
        });

        // Verifies that non-text inputs (checkbox, radio) don't trigger INSERT
        it("does NOT enter INSERT for checkbox input", () => {
            const checkbox = new FakeElement("INPUT", { type: "checkbox" });
            fireFocusIn(checkbox);
            assert.equal(keyHandler.getMode(), "NORMAL");
        });

        // Verifies that Escape exits INSERT mode
        it("Escape exits INSERT mode", () => {
            let exited = false;
            keyHandler.on("exitToNormal", () => {
                keyHandler.setMode(Mode.NORMAL);
                exited = true;
            });
            keyHandler.setMode(Mode.INSERT);
            fireKeyDown(makeKeyEvent("Escape"));
            assert.ok(exited);
            assert.equal(keyHandler.getMode(), "NORMAL");
        });

        // Verifies that normal keys are NOT consumed in INSERT mode
        it("passes through non-Escape keys in INSERT mode", () => {
            keyHandler.setMode(Mode.INSERT);
            const ev = makeKeyEvent("KeyJ");
            fireKeyDown(ev);
            assert.equal(ev.preventDefault.mock.callCount(), 0);
        });
    });

    describe("Overlay modes (HINTS, FIND, TAB_SEARCH)", () => {
        // Verifies that Escape dispatches exitToNormal in overlay modes
        for (const mode of ["HINTS", "FIND", "TAB_SEARCH"]) {
            it(`Escape dispatches exitToNormal in ${mode} mode`, () => {
                let called = false;
                keyHandler.on("exitToNormal", () => { called = true; });
                keyHandler.setMode(mode);
                fireKeyDown(makeKeyEvent("Escape"));
                assert.ok(called);
            });

            it(`non-Escape keys pass through in ${mode} mode`, () => {
                keyHandler.setMode(mode);
                const ev = makeKeyEvent("KeyJ");
                fireKeyDown(ev);
                assert.equal(ev.preventDefault.mock.callCount(), 0);
            });
        }
    });

    describe("Command registration", () => {
        // Verifies that on/off properly registers and unregisters handlers
        it("on registers and off unregisters command handler", () => {
            let count = 0;
            keyHandler.on("scrollDown", () => count++);
            fireKeyDown(makeKeyEvent("KeyJ"));
            assert.equal(count, 1);
            keyHandler.off("scrollDown");
            fireKeyDown(makeKeyEvent("KeyJ"));
            assert.equal(count, 1);
        });
    });

    describe("Modifier-only keypresses", () => {
        // Verifies that pressing Shift alone doesn't trigger anything
        it("ignores modifier-only keys", () => {
            const ev = makeKeyEvent("ShiftLeft", { shift: true });
            fireKeyDown(ev);
            assert.equal(ev.preventDefault.mock.callCount(), 0);
        });
    });

    describe("destroy()", () => {
        // Verifies that destroy cleans up listeners and state
        it("removes event listeners and clears state", () => {
            keyHandler.destroy();
            const ev = makeKeyEvent("KeyJ");
            fireKeyDown(ev);
            assert.equal(ev.preventDefault.mock.callCount(), 0);
        });
    });

    describe("Key binding mode — character mode", () => {
        // Verifies that character mode maps event.key letters to KeyX codes
        // so Dvorak/Colemak users get bindings based on character, not position
        it("maps lowercase letter via event.key in character mode", () => {
            // Dvorak: physical KeyS produces 'o' — character mode should normalize to KeyO
            const ev = makeKeyEvent("KeyS", { key: "o" });
            assert.equal(KeyHandler.normalizeKey(ev, "character"), "KeyO");
        });

        it("maps uppercase letter with Shift in character mode", () => {
            const ev = makeKeyEvent("KeyS", { key: "O", shift: true });
            assert.equal(KeyHandler.normalizeKey(ev, "character"), "Shift-KeyO");
        });

        it("maps digit via event.key in character mode", () => {
            const ev = makeKeyEvent("Digit5", { key: "5" });
            assert.equal(KeyHandler.normalizeKey(ev, "character"), "Digit5");
        });

        it("falls back to event.code for symbols in character mode", () => {
            // Shift+Digit4 produces '$' — should use event.code
            const ev = makeKeyEvent("Digit4", { key: "$", shift: true });
            assert.equal(KeyHandler.normalizeKey(ev, "character"), "Shift-Digit4");
        });

        it("falls back to event.code for special keys in character mode", () => {
            const ev = makeKeyEvent("Escape", { key: "Escape" });
            assert.equal(KeyHandler.normalizeKey(ev, "character"), "Escape");
        });

        it("uses event.code in location mode (default)", () => {
            // In location mode, event.key is ignored — physical position matters
            const ev = makeKeyEvent("KeyS", { key: "o" });
            assert.equal(KeyHandler.normalizeKey(ev, "location"), "KeyS");
        });

        it("defaults to location mode when no mode specified", () => {
            const ev = makeKeyEvent("KeyS", { key: "o" });
            assert.equal(KeyHandler.normalizeKey(ev), "KeyS");
        });

        // Verifies that setKeyBindingMode affects key dispatch
        it("dispatches based on character when mode is set to character", () => {
            let called = false;
            keyHandler.setKeyBindingMode("character");
            keyHandler.on("scrollDown", () => { called = true; });
            // Simulate Dvorak: physical KeyH produces 'j' character
            const ev = makeKeyEvent("KeyH", { key: "j" });
            fireKeyDown(ev);
            assert.ok(called, "scrollDown should fire for 'j' character on Dvorak layout");
        });

        it("dispatches based on position when mode is location", () => {
            let called = false;
            keyHandler.setKeyBindingMode("location");
            keyHandler.on("scrollDown", () => { called = true; });
            // Physical KeyJ, even if key is something else
            const ev = makeKeyEvent("KeyJ", { key: "c" });
            fireKeyDown(ev);
            assert.ok(called, "scrollDown should fire for physical KeyJ in location mode");
        });
    });
});
