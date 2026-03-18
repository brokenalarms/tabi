// HintMode unit tests — behavioral tests for label generation, progressive
// filtering, click dispatch, layout independence, and command wiring.
// Selector pipeline / DOM problem tests live in domProblems.test.ts.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { makeElement, makeKeyEvent, loadModules, fireKeyDown, fireMouseDown, getState } from "./hintTestHelpers";
import { HintMode } from "../src/modules/HintMode";

describe("HintMode", () => {
    afterEach(() => {
        const { hintMode, keyHandler } = getState();
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
            const { hintMode, keyHandler } = getState();
            hintMode.activate(false);
            assert.equal(keyHandler.getMode(), "HINTS");
            assert.ok(hintMode.isActive());
        });

        // Deactivating returns to NORMAL mode
        it("returns to NORMAL mode on deactivation", () => {
            const link = makeElement("A", { href: "https://example.com", top: 10, left: 10 });
            loadModules([link]);
            const { hintMode, keyHandler } = getState();
            hintMode.activate(false);
            hintMode.deactivate();
            assert.equal(keyHandler.getMode(), "NORMAL");
            assert.ok(!hintMode.isActive());
        });

        // Deactivates immediately when no elements found
        it("deactivates if no visible elements found", () => {
            loadModules([]);
            const { hintMode, keyHandler } = getState();
            hintMode.activate(false);
            assert.equal(keyHandler.getMode(), "NORMAL");
            assert.ok(!hintMode.isActive());
        });
    });

    describe("Progressive filtering", () => {
        // Typing a label character narrows visible hints
        it("hides non-matching hints as user types", () => {
            const links: any[] = [];
            // Create enough links to need multi-char labels (>14)
            for (let i = 0; i < 15; i++) {
                links.push(makeElement("A", { href: "#" + i, top: i * 20, left: 0 }));
            }
            loadModules(links);
            const { hintMode } = getState();
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
            const { hintMode, keyHandler } = getState();
            hintMode.activate(false);
            fireKeyDown(makeKeyEvent("Escape"));
            assert.ok(!hintMode.isActive());
            assert.equal(keyHandler.getMode(), "NORMAL");
        });

        // Backspace removes last typed character
        it("backspace removes last typed character", () => {
            const links: any[] = [];
            for (let i = 0; i < 15; i++) {
                links.push(makeElement("A", { href: "#" + i, top: i * 20, left: 0 }));
            }
            loadModules(links);
            const { hintMode } = getState();
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
            const { hintMode, keyHandler } = getState();
            hintMode.activate(false);

            fireKeyDown(makeKeyEvent("KeyZ", { key: "z" }));
            assert.ok(!hintMode.isActive());
            assert.equal(keyHandler.getMode(), "NORMAL");
        });

        // Typing a hint char that doesn't match any hint prefix deactivates
        it("deactivates when typed hint char matches no prefix", () => {
            const link = makeElement("A", { href: "#", top: 10, left: 0 });
            loadModules([link]);
            const { hintMode, keyHandler } = getState();
            hintMode.activate(false);
            assert.ok(hintMode.isActive());

            // With 1 element, label is "s". Typing "a" (a valid hint char but
            // doesn't match any hint prefix) should deactivate.
            fireKeyDown(makeKeyEvent("KeyA", { key: "a" }));
            assert.ok(!hintMode.isActive(), "Should deactivate when no hints match typed prefix");
            assert.equal(keyHandler.getMode(), "NORMAL");
        });

        // Mouse click dismisses hints
        it("deactivates on mousedown", () => {
            const link = makeElement("A", { href: "#", top: 10, left: 0 });
            loadModules([link]);
            const { hintMode, keyHandler } = getState();
            hintMode.activate(false);

            fireMouseDown();
            assert.ok(!hintMode.isActive());
            assert.equal(keyHandler.getMode(), "NORMAL");
        });
    });

    describe("Cancel and recovery", () => {
        // After cancelling hints, normal commands work again
        it("normal commands work after hint cancellation", () => {
            const link = makeElement("A", { href: "#", top: 10, left: 0 });
            loadModules([link]);
            const { hintMode, keyHandler } = getState();

            let scrollDownCalled = false;
            keyHandler.on("scrollDown", () => { scrollDownCalled = true; });

            // Activate and cancel hints
            hintMode.activate(false);
            assert.ok(hintMode.isActive());
            fireKeyDown(makeKeyEvent("KeyZ", { key: "z" })); // non-hint key cancels
            assert.ok(!hintMode.isActive());
            assert.equal(keyHandler.getMode(), "NORMAL");

            // Now press j — should dispatch scrollDown
            fireKeyDown(makeKeyEvent("KeyJ"));
            assert.ok(scrollDownCalled, "scrollDown should fire after hint cancellation");
        });

        // After no-match prefix cancel, normal commands work
        it("normal commands work after no-match prefix cancellation", () => {
            const link = makeElement("A", { href: "#", top: 10, left: 0 });
            loadModules([link]);
            const { hintMode, keyHandler } = getState();

            let scrollDownCalled = false;
            keyHandler.on("scrollDown", () => { scrollDownCalled = true; });

            // Activate hints, type valid hint char that doesn't match any prefix
            hintMode.activate(false);
            fireKeyDown(makeKeyEvent("KeyA", { key: "a" })); // label is "s", "a" doesn't match
            assert.ok(!hintMode.isActive());

            fireKeyDown(makeKeyEvent("KeyJ"));
            assert.ok(scrollDownCalled, "scrollDown should fire after no-match cancellation");
        });

        // After Escape cancel, normal commands work
        it("normal commands work after Escape cancellation", () => {
            const link = makeElement("A", { href: "#", top: 10, left: 0 });
            loadModules([link]);
            const { hintMode, keyHandler } = getState();

            let scrollDownCalled = false;
            keyHandler.on("scrollDown", () => { scrollDownCalled = true; });

            hintMode.activate(false);
            fireKeyDown(makeKeyEvent("Escape"));
            assert.ok(!hintMode.isActive());

            fireKeyDown(makeKeyEvent("KeyJ"));
            assert.ok(scrollDownCalled, "scrollDown should fire after Escape cancellation");
        });

        // After successful hint activation, normal commands work
        it("normal commands work after hint activation", () => {
            const link = makeElement("A", { href: "#", top: 10, left: 0 });
            loadModules([link]);
            const { hintMode, keyHandler } = getState();

            let scrollDownCalled = false;
            keyHandler.on("scrollDown", () => { scrollDownCalled = true; });

            hintMode.activate(false);
            fireKeyDown(makeKeyEvent("KeyS", { key: "s" })); // activates the hint
            assert.ok(!hintMode.isActive());

            fireKeyDown(makeKeyEvent("KeyJ"));
            assert.ok(scrollDownCalled, "scrollDown should fire after hint activation");
        });
    });

    describe("Layout independence", () => {
        // Hint typing uses event.key (layout character), not event.code (physical position)
        it("matches hints by event.key, not event.code", () => {
            // Create 15 links so labels are 2-char (ss, sa, sd, ...)
            const links: any[] = [];
            for (let i = 0; i < 15; i++) {
                links.push(makeElement("A", { href: "#" + i, top: i * 20, left: 0 }));
            }
            loadModules(links);
            const { hintMode } = getState();
            hintMode.activate(false);

            // Simulate a non-QWERTY layout: physical KeyD produces "h" on this layout.
            // The hint label "sh" should match when user types key="s" then key="h",
            // regardless of which physical keys produced those characters.
            fireKeyDown(makeKeyEvent("KeyS", { key: "s" }));   // physical S, produces "s"
            assert.ok(hintMode.isActive());
            fireKeyDown(makeKeyEvent("KeyD", { key: "h" }));   // physical D, but layout produces "h"
            // "sh" is a valid 2-char label (index 7) — should activate that hint
            assert.ok(!hintMode.isActive(), "Should match hint 'sh' via event.key='h', not event.code='KeyD'");
        });

        // Hint typing ignores event.code entirely — wrong code, right key still works
        it("ignores event.code for hint matching", () => {
            const link = makeElement("A", { href: "#", top: 10, left: 0 });
            loadModules([link]);
            const { hintMode } = getState();
            hintMode.activate(false);

            // Label is "s". Send event with code=KeyO but key="s" (remapped layout).
            // Should still match because we use event.key.
            fireKeyDown(makeKeyEvent("KeyO", { key: "s" }));
            assert.ok(!hintMode.isActive(), "Should activate hint via event.key='s' despite code='KeyO'");
            assert.equal(link.click.mock.callCount(), 1);
        });

        // setKeyBindingMode("character") does NOT affect hint typing
        it("positional/character key binding mode does not affect hint typing", () => {
            const link = makeElement("A", { href: "#", top: 10, left: 0 });
            loadModules([link]);
            const { hintMode, keyHandler } = getState();
            keyHandler.setKeyBindingMode("character");

            hintMode.activate(false);
            assert.ok(hintMode.isActive());

            // Label is "s". Physical KeyD with key="s" (simulating remapped layout).
            // Even in character mode, hint typing should use event.key.
            fireKeyDown(makeKeyEvent("KeyD", { key: "s" }));
            assert.ok(!hintMode.isActive(), "Hint typing should use event.key regardless of keyBindingMode");
            assert.equal(link.click.mock.callCount(), 1);
        });

        // setKeyBindingMode("location") does NOT affect hint typing
        it("location key binding mode does not affect hint typing", () => {
            const link = makeElement("A", { href: "#", top: 10, left: 0 });
            loadModules([link]);
            const { hintMode, keyHandler } = getState();
            keyHandler.setKeyBindingMode("location");

            hintMode.activate(false);

            // Same test — physical KeyD with key="s"
            fireKeyDown(makeKeyEvent("KeyD", { key: "s" }));
            assert.ok(!hintMode.isActive(), "Hint typing should use event.key regardless of keyBindingMode");
            assert.equal(link.click.mock.callCount(), 1);
        });
    });

    describe("Click dispatch", () => {
        // Clicking a hint in current-tab mode calls element.click()
        it("clicks element for f-mode (current tab)", () => {
            const link = makeElement("A", { href: "https://example.com", top: 10, left: 0 });
            loadModules([link]);
            const { hintMode } = getState();
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
            const { hintMode } = getState();
            hintMode.activate(true);

            fireKeyDown(makeKeyEvent("KeyS", { key: "s" }));
            assert.equal((globalThis as any).browser.runtime.sendMessage.mock.callCount(), 1);
            const msg = (globalThis as any).browser.runtime.sendMessage.mock.calls[0].arguments[0];
            assert.equal(msg.command, "createTab");
            assert.equal(msg.url, "https://example.com/");
            assert.ok(!hintMode.isActive());
        });

        // F-mode falls back to click for non-link elements
        it("falls back to click for non-link elements in F-mode", () => {
            const btn = makeElement("BUTTON", { top: 10, left: 0 });
            loadModules([btn]);
            const { hintMode } = getState();
            hintMode.activate(true);

            fireKeyDown(makeKeyEvent("KeyS", { key: "s" }));
            assert.equal(btn.click.mock.callCount(), 1);
        });

        // ISSUE: Links with target="_blank" are blocked by Safari popup blocker
        // when activated via element.click() (not a trusted user gesture).
        // SITE: linkedin.com — nav links with target="_blank"
        // FIX: Route target="_blank" links through createTab (extension API),
        // same as Shift+F mode, to bypass popup blocking.
        it("sends createTab for target=_blank links in f-mode", () => {
            const link = makeElement("A", { href: "https://www.linkedin.com/learning/", top: 10, left: 0 });
            link.setAttribute("target", "_blank");
            loadModules([link]);
            const { hintMode } = getState();
            hintMode.activate(false); // f-mode (current tab)

            fireKeyDown(makeKeyEvent("KeyS", { key: "s" }));
            // Should use createTab, NOT element.click()
            assert.equal((globalThis as any).browser.runtime.sendMessage.mock.callCount(), 1);
            const msg = (globalThis as any).browser.runtime.sendMessage.mock.calls[0].arguments[0];
            assert.equal(msg.command, "createTab");
            assert.equal(msg.url, "https://www.linkedin.com/learning/");
            assert.equal(link.click.mock.callCount(), 0, "Should not call element.click() for target=_blank");
        });
    });

    describe("Command wiring", () => {
        // f key triggers activateHints via KeyHandler
        it("f triggers hint activation via command", () => {
            const link = makeElement("A", { href: "#", top: 10, left: 0 });
            loadModules([link]);
            const { hintMode, keyHandler } = getState();

            // Simulate pressing f in NORMAL mode
            fireKeyDown(makeKeyEvent("KeyF"));
            assert.ok(hintMode.isActive());
            assert.equal(keyHandler.getMode(), "HINTS");
        });

        // Shift+F triggers new-tab hint activation
        it("Shift+F triggers new-tab hint activation", () => {
            const link = makeElement("A", { href: "#", top: 10, left: 0 });
            loadModules([link]);
            const { hintMode } = getState();

            fireKeyDown(makeKeyEvent("KeyF", { shift: true }));
            assert.ok(hintMode.isActive());
        });

        // unwireCommands prevents f from activating hints
        it("unwireCommands disables hint activation", () => {
            const link = makeElement("A", { href: "#", top: 10, left: 0 });
            loadModules([link]);
            const { hintMode } = getState();
            hintMode.unwireCommands();

            fireKeyDown(makeKeyEvent("KeyF"));
            assert.ok(!hintMode.isActive());
        });

        // wireCommands re-enables after unwire
        it("wireCommands re-enables hint activation", () => {
            const link = makeElement("A", { href: "#", top: 10, left: 0 });
            loadModules([link]);
            const { hintMode } = getState();
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
            const { hintMode } = getState();
            hintMode.destroy();

            // f should no longer activate hints
            fireKeyDown(makeKeyEvent("KeyF"));
            assert.ok(!hintMode.isActive());
        });
    });

    describe("Pill text content targeting", () => {
        // angrymetalguy.com nav: <a> links contain <span> children but the <a>
        // has large padding/height from parent sizing. The pill should point at
        // the children's content bottom, not the padded <a> box bottom.
        it("narrows pill rect vertically to children content bounds", () => {
            // <a> is 80px tall (from parent sizing), but <span> text is only 20px
            const span = makeElement("SPAN", { top: 10, left: 20, width: 60, height: 20 });
            const link = makeElement("A", {
                href: "#",
                top: 0, left: 0, width: 200, height: 80,
                children: [span],
            });

            loadModules([link]);
            const { hintMode } = getState();
            hintMode.activate(false);
            assert.ok(hintMode.isActive());

            const overlay = document.documentElement.querySelector(".vimium-hint-overlay");
            const hint = overlay?.querySelector(".vimium-hint") as HTMLElement;
            assert.ok(hint, "hint div should exist");
            // Pill at children bottom: span.bottom(30), not 82px
            assert.equal(hint.style.top, "30px");
        });

        // Base case: without children, padding-bottom subtraction still works
        it("subtracts padding-bottom for text-only links", () => {
            const li = makeElement("LI", { top: 0, left: 0, width: 36, height: 60 });
            const link = makeElement("A", {
                href: "#",
                top: 0, left: 0, width: 36, height: 60,
                paddingBottom: "20px",
            });
            li.appendChild(link);

            loadModules([link]);
            const { hintMode } = getState();
            hintMode.activate(false);
            assert.ok(hintMode.isActive());

            const overlay = document.documentElement.querySelector(".vimium-hint-overlay");
            const hint = overlay?.querySelector(".vimium-hint") as HTMLElement;
            assert.ok(hint, "hint div should exist");
            // Pill at content edge: (60 - 20) = 40px, not 62px
            assert.equal(hint.style.top, "40px");
        });

        // AngryMetalGuy: uppercase category links with large line-height push pill
        // below visual text bottom. Half-leading ((lineHeight - fontSize) / 2)
        // should be subtracted from rect bottom so pill aligns with text.
        it("subtracts half-leading for text-only links with explicit line-height", () => {
            const li = makeElement("LI", { top: 0, left: 0, width: 36, height: 40 });
            // fontSize 16px, lineHeight 32px → halfLeading = 8px
            const link = makeElement("A", {
                href: "#",
                top: 0, left: 0, width: 36, height: 32,
                fontSize: "16px",
                lineHeight: "32px",
            });
            li.appendChild(link);

            loadModules([link]);
            const { hintMode } = getState();
            hintMode.activate(false);

            const overlay = document.documentElement.querySelector(".vimium-hint-overlay");
            const hint = overlay?.querySelector(".vimium-hint") as HTMLElement;
            assert.ok(hint);
            // Pill at: rect.bottom(32) - halfLeading(8) = 24px
            assert.equal(hint.style.top, "24px");
        });

        // Base case: no leading adjustment when line-height is not set
        it("no half-leading subtraction without explicit line-height", () => {
            const li = makeElement("LI", { top: 0, left: 0, width: 36, height: 40 });
            const link = makeElement("A", {
                href: "#",
                top: 0, left: 0, width: 36, height: 32,
            });
            li.appendChild(link);

            loadModules([link]);
            const { hintMode } = getState();
            hintMode.activate(false);

            const overlay = document.documentElement.querySelector(".vimium-hint-overlay");
            const hint = overlay?.querySelector(".vimium-hint") as HTMLElement;
            assert.ok(hint);
            // No line-height set → no adjustment: rect.bottom(32) = 32px
            assert.equal(hint.style.top, "32px");
        });

        // Base case: no padding, no children — hint at rect.bottom
        it("places hint at bottom edge when no padding and no children", () => {
            const li = makeElement("LI", { top: 0, left: 0, width: 36, height: 40 });
            const link = makeElement("A", {
                href: "#",
                top: 0, left: 0, width: 36, height: 40,
            });
            li.appendChild(link);

            loadModules([link]);
            const { hintMode } = getState();
            hintMode.activate(false);

            const overlay = document.documentElement.querySelector(".vimium-hint-overlay");
            const hint = overlay?.querySelector(".vimium-hint") as HTMLElement;
            assert.ok(hint);
            assert.equal(hint.style.top, "40px");
        });
    });
});
