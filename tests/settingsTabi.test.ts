// Settings page Tabi integration — verifies that keyboard hint navigation
// works when initialized directly on the settings page (extension pages don't
// receive content script injection, so Tabi is bundled into settings.ts).

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
    makeElement,
    makeKeyEvent,
    loadModules,
    fireKeyDown,
    getState,
} from "./hintTestHelpers";

function getHintCount(): number {
    const doc = (globalThis as any).document;
    const overlay = doc.documentElement.querySelector(".tabi-hint-overlay");
    const hints = overlay?.querySelectorAll(".tabi-hint");
    return hints?.length ?? 0;
}

describe("Settings page Tabi navigation", () => {
    afterEach(() => {
        const { hintMode, keyHandler } = getState();
        if (hintMode) hintMode.destroy();
        if (keyHandler) keyHandler.destroy();
    });

    it("pressing F activates hint mode via wireCommands", () => {
        const link = makeElement("A", { href: "#general", top: 10, left: 10, textContent: "General" });
        loadModules([link]);
        const { hintMode, keyHandler } = getState();

        assert.ok(!hintMode.isActive(), "hints should not be active before pressing F");
        assert.equal(keyHandler.getMode(), "NORMAL");

        fireKeyDown(makeKeyEvent("KeyF", { key: "f" }));

        assert.ok(hintMode.isActive(), "pressing F should activate hint mode");
        assert.equal(keyHandler.getMode(), "HINTS");
    });

    it("sidebar links receive hints", () => {
        const links = [
            makeElement("A", { href: "#general", top: 10, left: 10, textContent: "General" }),
            makeElement("A", { href: "#keybindings", top: 40, left: 10, textContent: "Key Bindings" }),
            makeElement("A", { href: "#advanced", top: 70, left: 10, textContent: "Advanced" }),
        ];
        loadModules(links);
        const { hintMode } = getState();

        hintMode.activate();
        assert.ok(hintMode.isActive());
        assert.equal(getHintCount(), 3, "each sidebar link should get a hint");
    });

    it("toggle checkboxes and buttons receive hints", () => {
        const toggle = makeElement("INPUT", { type: "checkbox", top: 10, left: 200 });
        const button = makeElement("BUTTON", { top: 40, left: 200, textContent: "Save" });
        loadModules([toggle, button]);
        const { hintMode } = getState();

        hintMode.activate();
        assert.equal(getHintCount(), 2, "checkbox and button should both get hints");
    });

    it("selecting a hint clicks the settings element", () => {
        const link = makeElement("A", { href: "#general", top: 10, left: 10, textContent: "General" });
        loadModules([link]);
        const { hintMode } = getState();

        hintMode.activate();
        assert.ok(hintMode.isActive());

        fireKeyDown(makeKeyEvent("KeyS", { key: "s" }));
        assert.equal((link.click as any).mock.callCount(), 1, "hint selection should click the element");
    });

    it("Escape exits hint mode back to normal", () => {
        const link = makeElement("A", { href: "#general", top: 10, left: 10, textContent: "General" });
        loadModules([link]);
        const { hintMode, keyHandler } = getState();

        fireKeyDown(makeKeyEvent("KeyF", { key: "f" }));
        assert.ok(hintMode.isActive());

        fireKeyDown(makeKeyEvent("Escape"));
        assert.ok(!hintMode.isActive());
        assert.equal(keyHandler.getMode(), "NORMAL");
    });
});
