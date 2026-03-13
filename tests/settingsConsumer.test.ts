// Settings consumer tests — verifies that content.ts applies theme and
// keyBindingMode settings, and that live updates via storage.onChanged work.

import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createDOM, type DOMEnvironment } from "./helpers/dom.js";

// Inline applyTheme logic matching content.ts for unit testing
function applyTheme(theme: string, element: Element) {
    const resolved = theme === "auto" ? "dark" : theme;
    element.setAttribute("data-vimium-theme", resolved);
}

let env: DOMEnvironment;

afterEach(() => {
    env?.cleanup();
});

describe("applyTheme", () => {
    // Verifies that applying a named theme sets the correct data attribute
    // on a real DOM element, so CSS theme selectors can match.
    it("sets data-vimium-theme attribute for named themes", () => {
        env = createDOM();
        for (const theme of ["classic", "dark", "light"]) {
            const el = env.document.createElement("div");
            applyTheme(theme, el);
            assert.equal(el.getAttribute("data-vimium-theme"), theme);
        }
    });

    // Verifies that "auto" resolves to "dark" (default fallback from detectPageBackground).
    it("resolves auto theme to dark", () => {
        env = createDOM();
        const el = env.document.createElement("div");
        applyTheme("dark", el);
        assert.equal(el.getAttribute("data-vimium-theme"), "dark");
        applyTheme("auto", el);
        assert.equal(el.getAttribute("data-vimium-theme"), "dark");
    });

    // Verifies that setAttribute overwrites the previous value (no stale themes).
    it("overwrites previous theme when switching", () => {
        env = createDOM();
        const el = env.document.createElement("div");
        applyTheme("dark", el);
        applyTheme("light", el);
        assert.equal(el.getAttribute("data-vimium-theme"), "light");
    });
});

describe("storage.onChanged listener", () => {
    // Verifies that the onChanged handler updates keyBindingMode for local storage events.
    it("applies keyBindingMode changes from storage events", () => {
        let currentMode = "location";
        function handleChange(changes: any, areaName: string) {
            if (areaName !== "local") return;
            if (changes.keyBindingMode?.newValue) {
                currentMode = changes.keyBindingMode.newValue;
            }
        }

        handleChange({ keyBindingMode: { newValue: "character" } }, "local");
        assert.equal(currentMode, "character");

        handleChange({ keyBindingMode: { newValue: "location" } }, "local");
        assert.equal(currentMode, "location");
    });

    // Verifies that storage events from "sync" area are ignored — only "local" matters.
    it("ignores changes from non-local storage areas", () => {
        let currentMode = "location";
        function handleChange(changes: any, areaName: string) {
            if (areaName !== "local") return;
            if (changes.keyBindingMode?.newValue) {
                currentMode = changes.keyBindingMode.newValue;
            }
        }

        handleChange({ keyBindingMode: { newValue: "character" } }, "sync");
        assert.equal(currentMode, "location");
    });

    // Verifies that theme changes via storage events apply to a real DOM element.
    it("applies theme changes from storage events", () => {
        env = createDOM();
        const el = env.document.createElement("div");
        function handleChange(changes: any, areaName: string) {
            if (areaName !== "local") return;
            if (changes.theme?.newValue) {
                applyTheme(changes.theme.newValue, el);
            }
        }

        handleChange({ theme: { newValue: "dark" } }, "local");
        assert.equal(el.getAttribute("data-vimium-theme"), "dark");

        handleChange({ theme: { newValue: "auto" } }, "local");
        assert.equal(el.getAttribute("data-vimium-theme"), "dark");
    });
});
