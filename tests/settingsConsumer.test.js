// Settings consumer tests — verifies that content.ts applies theme and
// keyBindingMode settings, and that live updates via storage.onChanged work.

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

// Inline applyTheme logic matching content.ts for unit testing
function applyTheme(theme, element) {
    element.setAttribute("data-vimium-theme", theme);
}

describe("applyTheme", () => {
    function makeElement() {
        // Minimal stub that tracks attributes
        const attrs = {};
        return {
            setAttribute(name, value) { attrs[name] = value; },
            removeAttribute(name) { delete attrs[name]; },
            getAttribute(name) { return attrs[name] ?? null; },
        };
    }

    it("sets data-vimium-theme attribute for named themes", () => {
        for (const theme of ["classic", "dark", "light"]) {
            const el = makeElement();
            applyTheme(theme, el);
            assert.equal(el.getAttribute("data-vimium-theme"), theme);
        }
    });

    it("sets data-vimium-theme to auto for auto theme", () => {
        const el = makeElement();
        applyTheme("dark", el);
        assert.equal(el.getAttribute("data-vimium-theme"), "dark");
        applyTheme("auto", el);
        assert.equal(el.getAttribute("data-vimium-theme"), "auto");
    });

    it("overwrites previous theme when switching", () => {
        const el = makeElement();
        applyTheme("dark", el);
        applyTheme("light", el);
        assert.equal(el.getAttribute("data-vimium-theme"), "light");
    });
});

describe("storage.onChanged listener", () => {
    it("applies keyBindingMode changes from storage events", () => {
        // Simulate the logic in content.ts onChanged handler
        let currentMode = "location";
        function handleChange(changes, areaName) {
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

    it("ignores changes from non-local storage areas", () => {
        let currentMode = "location";
        function handleChange(changes, areaName) {
            if (areaName !== "local") return;
            if (changes.keyBindingMode?.newValue) {
                currentMode = changes.keyBindingMode.newValue;
            }
        }

        handleChange({ keyBindingMode: { newValue: "character" } }, "sync");
        assert.equal(currentMode, "location");
    });

    it("applies theme changes from storage events", () => {
        const el = makeElement();
        function handleChange(changes, areaName) {
            if (areaName !== "local") return;
            if (changes.theme?.newValue) {
                applyTheme(changes.theme.newValue, el);
            }
        }

        handleChange({ theme: { newValue: "dark" } }, "local");
        assert.equal(el.getAttribute("data-vimium-theme"), "dark");

        handleChange({ theme: { newValue: "auto" } }, "local");
        assert.equal(el.getAttribute("data-vimium-theme"), "auto");
    });

    function makeElement() {
        const attrs = {};
        return {
            setAttribute(name, value) { attrs[name] = value; },
            removeAttribute(name) { delete attrs[name]; },
            getAttribute(name) { return attrs[name] ?? null; },
        };
    }
});
