// KeyHandler unit tests — using Node.js built-in test runner + happy-dom.
// Tests the mode state machine, key sequence parser with timeout,
// input field detection, and command dispatch.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createDOM, type DOMEnvironment } from "./helpers/dom";
import { KeyHandler } from "../src/modules/KeyHandler";
import { Mode } from "../src/commands";

let env: DOMEnvironment;
let keyHandler: KeyHandler;

function makeKeyEvent(code: string, opts: { key?: string; shift?: boolean; ctrl?: boolean; alt?: boolean; meta?: boolean } = {}) {
    return new KeyboardEvent("keydown", {
        code,
        key: opts.key || "",
        shiftKey: opts.shift || false,
        ctrlKey: opts.ctrl || false,
        altKey: opts.alt || false,
        metaKey: opts.meta || false,
        bubbles: true,
        cancelable: true,
    });
}

function fireKeyDown(event: KeyboardEvent) {
    document.dispatchEvent(event);
}

function fireFocusIn(el: Element) {
    el.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
}

function fireFocusOut(el: Element) {
    el.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
}

describe("KeyHandler", () => {
    beforeEach(() => {
        env = createDOM();
        // happy-dom needs FocusEvent and KeyboardEvent on globalThis
        (globalThis as any).FocusEvent = (env.window as any).FocusEvent;
        (globalThis as any).KeyboardEvent = (env.window as any).KeyboardEvent;
        keyHandler = new KeyHandler();
    });

    afterEach(() => {
        if (keyHandler) keyHandler.destroy();
        delete (globalThis as any).FocusEvent;
        delete (globalThis as any).KeyboardEvent;
        env.cleanup();
    });

    describe("Mode state machine", () => {
        // Verifies initial mode and transitions between all five modes
        it("starts in NORMAL mode", () => {
            assert.equal(keyHandler.getMode(), "NORMAL");
        });

        it("transitions between modes and fires listeners", () => {
            const transitions: { to: string; from: string }[] = [];
            keyHandler.onModeChange((to, from) => transitions.push({ to, from }));

            keyHandler.setMode(Mode.INSERT);
            assert.equal(keyHandler.getMode(), "INSERT");

            keyHandler.setMode(Mode.HINTS);
            assert.equal(keyHandler.getMode(), "HINTS");

            keyHandler.setMode(Mode.TAB_SEARCH);
            assert.equal(keyHandler.getMode(), "TAB_SEARCH");

            keyHandler.setMode(Mode.NORMAL);
            assert.equal(keyHandler.getMode(), "NORMAL");

            assert.equal(transitions.length, 4);
            assert.equal(transitions[0].from, "NORMAL");
            assert.equal(transitions[0].to, "INSERT");
        });

        // Setting the same mode is a no-op
        it("does not fire listener for same-mode transition", () => {
            const transitions: string[] = [];
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
            assert.ok(ev.defaultPrevented);
        });

        // Tests that shift+key dispatches a different command (Shift+J → scrollToBottom)
        it("dispatches shift-modified binding", () => {
            let called = false;
            keyHandler.on("scrollToBottom", () => { called = true; });
            fireKeyDown(makeKeyEvent("KeyJ", { shift: true }));
            assert.ok(called);
        });

        // Tests that unbound keys pass through without being consumed
        it("ignores unbound keys", () => {
            const ev = makeKeyEvent("KeyZ");
            fireKeyDown(ev);
            assert.ok(!ev.defaultPrevented);
        });
    });

    describe("Single-key navigation commands", () => {
        // I dispatches focusInput (replaced multi-key gi)
        it("dispatches focusInput on I", () => {
            let called = false;
            keyHandler.on("focusInput", () => { called = true; });
            fireKeyDown(makeKeyEvent("KeyI"));
            assert.ok(called, "focusInput should be called for I");
        });

        // U dispatches goUpUrl (replaced multi-key gu)
        it("dispatches goUpUrl on U", () => {
            let called = false;
            keyHandler.on("goUpUrl", () => { called = true; });
            fireKeyDown(makeKeyEvent("KeyU"));
            assert.ok(called);
        });
    });

    describe("Multi-key sequence with timeout", () => {

        // Tests that g+0 dispatches goToTabFirst
        it("dispatches g0 sequence", () => {
            let called = false;
            keyHandler.on("goToTabFirst", () => { called = true; });
            fireKeyDown(makeKeyEvent("KeyG"));
            fireKeyDown(makeKeyEvent("Digit0"));
            assert.ok(called);
        });

        // Tests that g+$ (Shift-4) dispatches goToTabLast
        it("dispatches g$ sequence", () => {
            let called = false;
            keyHandler.on("goToTabLast", () => { called = true; });
            fireKeyDown(makeKeyEvent("KeyG"));
            fireKeyDown(makeKeyEvent("Digit4", { shift: true }));
            assert.ok(called);
        });

        // Tests that g+5 dispatches goToTab5
        it("dispatches g5 sequence", () => {
            let called = false;
            keyHandler.on("goToTab5", () => { called = true; });
            fireKeyDown(makeKeyEvent("KeyG"));
            fireKeyDown(makeKeyEvent("Digit5"));
            assert.ok(called);
        });

        // Tests that g+^ (Shift-6) dispatches goToTabFirst
        it("dispatches g^ sequence", () => {
            let called = false;
            keyHandler.on("goToTabFirst", () => { called = true; });
            fireKeyDown(makeKeyEvent("KeyG"));
            fireKeyDown(makeKeyEvent("Digit6", { shift: true }));
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
            assert.ok(ev.defaultPrevented);
        });
    });

    describe("Input field detection and auto-INSERT mode", () => {
        // Verifies that focusing a text input switches to INSERT mode
        it("enters INSERT mode on text input focus", () => {
            const input = document.createElement("input");
            input.type = "text";
            document.body.appendChild(input);
            fireFocusIn(input);
            assert.equal(keyHandler.getMode(), "INSERT");
        });

        // Verifies that leaving input switches back to NORMAL
        it("exits INSERT mode on input blur", () => {
            const input = document.createElement("input");
            input.type = "text";
            document.body.appendChild(input);
            fireFocusIn(input);
            assert.equal(keyHandler.getMode(), "INSERT");
            fireFocusOut(input);
            assert.equal(keyHandler.getMode(), "NORMAL");
        });

        // Verifies that textarea also triggers INSERT mode
        it("enters INSERT mode on textarea focus", () => {
            const textarea = document.createElement("textarea");
            document.body.appendChild(textarea);
            fireFocusIn(textarea);
            assert.equal(keyHandler.getMode(), "INSERT");
        });

        // Verifies that contentEditable elements trigger INSERT mode
        it("enters INSERT mode on contentEditable focus", () => {
            const div = document.createElement("div");
            div.contentEditable = "true";
            document.body.appendChild(div);
            fireFocusIn(div);
            assert.equal(keyHandler.getMode(), "INSERT");
        });

        // Verifies that non-text inputs (checkbox, radio) don't trigger INSERT
        it("does NOT enter INSERT for checkbox input", () => {
            const checkbox = document.createElement("input");
            checkbox.type = "checkbox";
            document.body.appendChild(checkbox);
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
            assert.ok(!ev.defaultPrevented);
        });

        // Fallback: if focusin never fired (e.g. input was already focused
        // when content script loaded), keydown should detect the focused
        // input via document.activeElement and switch to INSERT.
        it("switches to INSERT on keydown when input is already focused", () => {
            let called = false;
            keyHandler.on("scrollDown", () => { called = true; });
            const input = document.createElement("input");
            input.type = "text";
            document.body.appendChild(input);
            // Focus the input, then forcibly reset mode to NORMAL to simulate
            // the content script loading after the field was already focused
            // (focusin already fired but the KeyHandler wasn't listening yet).
            input.focus();
            keyHandler.setMode(Mode.NORMAL);
            assert.equal(keyHandler.getMode(), "NORMAL");
            const ev = makeKeyEvent("KeyJ");
            fireKeyDown(ev);
            assert.equal(keyHandler.getMode(), "INSERT");
            assert.ok(!called, "command should not fire when input is focused");
            assert.ok(!ev.defaultPrevented);
        });
    });

    describe("Overlay modes (HINTS, TAB_SEARCH)", () => {
        // Verifies that Escape dispatches exitToNormal in overlay modes
        for (const mode of ["HINTS", "TAB_SEARCH"] as const) {
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
                assert.ok(!ev.defaultPrevented);
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
            assert.ok(!ev.defaultPrevented);
        });
    });

    describe("destroy()", () => {
        // Verifies that destroy cleans up listeners and state
        it("removes event listeners and clears state", () => {
            keyHandler.destroy();
            const ev = makeKeyEvent("KeyJ");
            fireKeyDown(ev);
            assert.ok(!ev.defaultPrevented);
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

        it("maps / to Slash in character mode (Dvorak / key)", () => {
            // On Dvorak, / is at physical BracketLeft position
            // Character mode should map the "/" character to canonical Slash code
            const ev = makeKeyEvent("BracketLeft", { key: "/" });
            assert.equal(KeyHandler.normalizeKey(ev, "character"), "Slash");
        });

        it("maps ? to Shift-Slash in character mode", () => {
            const ev = makeKeyEvent("BracketLeft", { key: "?", shift: true });
            assert.equal(KeyHandler.normalizeKey(ev, "character"), "Shift-Slash");
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

    describe("Layout switching via setLayout()", () => {
        // Verifies that setLayout() clears old bindings and applies new ones,
        // allowing users to switch between key layout presets at runtime.

        it("switches from optimized to vim layout", () => {
            // Base: optimized layout has J bound to scrollDown
            let scrollDownCalled = false;
            keyHandler.on("scrollDown", () => { scrollDownCalled = true; });
            fireKeyDown(makeKeyEvent("KeyJ"));
            assert.ok(scrollDownCalled, "J dispatches scrollDown in optimized layout");

            // Delta: switch to vim — J should still dispatch scrollDown (same key)
            scrollDownCalled = false;
            keyHandler.setLayout("vim");
            fireKeyDown(makeKeyEvent("KeyJ"));
            assert.ok(scrollDownCalled, "J dispatches scrollDown in vim layout too");
        });

        it("switches to leftHand layout — WASD replaces HJKL", () => {
            // Base: optimized layout — S is not bound
            let scrollDownCalled = false;
            keyHandler.on("scrollDown", () => { scrollDownCalled = true; });
            const evS = makeKeyEvent("KeyS");
            fireKeyDown(evS);
            assert.ok(!scrollDownCalled, "S should not dispatch scrollDown in optimized layout");

            // Delta: leftHand layout — S dispatches scrollDown (WASD scheme)
            keyHandler.setLayout("leftHand");
            fireKeyDown(makeKeyEvent("KeyS"));
            assert.ok(scrollDownCalled, "S dispatches scrollDown in leftHand layout");
        });

        it("switches to rightHand layout — semicolon changes from jumpMark to goUpUrl", () => {
            // Base: optimized layout — Semicolon dispatches jumpMark
            let jumpMarkCalled = false;
            keyHandler.on("jumpMark", () => { jumpMarkCalled = true; });
            fireKeyDown(makeKeyEvent("Semicolon"));
            assert.ok(jumpMarkCalled, "Semicolon dispatches jumpMark in optimized layout");

            // Delta: rightHand layout — Semicolon dispatches goUpUrl instead
            let goUpCalled = false;
            keyHandler.on("goUpUrl", () => { goUpCalled = true; });
            keyHandler.setLayout("rightHand");
            fireKeyDown(makeKeyEvent("Semicolon"));
            assert.ok(goUpCalled, "Semicolon dispatches goUpUrl in rightHand layout");
        });

        it("clears old bindings when switching layouts", () => {
            // Base: optimized layout — F activates hints
            let hintsCalled = false;
            keyHandler.on("activateHints", () => { hintsCalled = true; });
            fireKeyDown(makeKeyEvent("KeyF"));
            assert.ok(hintsCalled, "F dispatches activateHints in optimized layout");

            // Delta: rightHand layout — F is no longer bound
            hintsCalled = false;
            keyHandler.setLayout("rightHand");
            const ev = makeKeyEvent("KeyF");
            fireKeyDown(ev);
            assert.ok(!hintsCalled, "F should not dispatch activateHints in rightHand layout");
            assert.ok(!ev.defaultPrevented, "F should not be consumed in rightHand layout");
        });

        it("preserves Escape binding after layout switch", () => {
            // Escape should work in all modes regardless of layout
            keyHandler.setLayout("leftHand");
            let exitCalled = false;
            keyHandler.on("exitToNormal", () => { exitCalled = true; });
            keyHandler.setMode(Mode.INSERT);
            fireKeyDown(makeKeyEvent("Escape"));
            assert.ok(exitCalled, "Escape still exits INSERT after layout switch");
        });
    });
});
