import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import {
  isPremiumActive,
  setPremiumStatus,
  guardPremium,
  showPremiumPrompt,
} from "../src/premium.js";

let win: InstanceType<typeof Window>;

function setup(): void {
  win = new Window({ url: "https://localhost/" });
  (globalThis as any).window = win;
  (globalThis as any).document = win.document;
  (globalThis as any).HTMLElement = (win as any).HTMLElement;
  // Ensure body exists
  win.document.body.innerHTML = "";
}

function teardown(): void {
  setPremiumStatus(false);
  win.close();
  delete (globalThis as any).window;
  delete (globalThis as any).document;
  delete (globalThis as any).HTMLElement;
}

describe("premium", () => {
  beforeEach(setup);
  afterEach(teardown);

  describe("isPremiumActive", () => {
    // Premium status defaults to false and can be toggled
    it("defaults to false and reflects setPremiumStatus", () => {
      // Base: not premium by default
      assert.equal(isPremiumActive(), false);

      // Delta: setting to true activates premium
      setPremiumStatus(true);
      assert.equal(isPremiumActive(), true);

      // Delta: setting back to false deactivates
      setPremiumStatus(false);
      assert.equal(isPremiumActive(), false);
    });
  });

  describe("guardPremium", () => {
    // guardPremium returns true and shows no toast when premium is active
    it("returns true without showing toast when premium", () => {
      setPremiumStatus(true);
      const result = guardPremium("Yank mode");

      assert.equal(result, true);
      const toast = win.document.querySelector(".tabi-premium-toast");
      assert.equal(toast, null);
    });

    // guardPremium returns false and shows upgrade toast when not premium
    it("returns false and shows toast when not premium", () => {
      // Base: not premium
      assert.equal(isPremiumActive(), false);

      const result = guardPremium("Yank mode");

      assert.equal(result, false);
      const toast = win.document.querySelector(".tabi-premium-toast");
      assert.notEqual(toast, null);
      assert.ok(toast!.textContent!.includes("Yank mode"));
      assert.ok(toast!.textContent!.includes("Purchase"));
    });
  });

  describe("showPremiumPrompt", () => {
    // Toast displays feature name and upgrade CTA
    it("creates toast with feature name and CTA", () => {
      showPremiumPrompt("Tab search");

      const toast = win.document.querySelector(".tabi-premium-toast");
      assert.notEqual(toast, null);
      const strong = toast!.querySelector("strong");
      assert.equal(strong!.textContent, "Tab search requires Premium");
      const cta = toast!.querySelector(".tabi-premium-cta");
      assert.equal(cta!.textContent, "Purchase in the Tabi app");
    });

    // Showing a second toast replaces the first (no stacking)
    it("replaces existing toast instead of stacking", () => {
      showPremiumPrompt("Feature A");
      showPremiumPrompt("Feature B");

      const toasts = win.document.querySelectorAll(".tabi-premium-toast");
      assert.equal(toasts.length, 1);
      assert.ok(toasts[0].textContent!.includes("Feature B"));
    });

    // Toast is dismissed by Escape key
    it("dismisses on Escape keydown", () => {
      showPremiumPrompt("Quick marks");
      assert.notEqual(win.document.querySelector(".tabi-premium-toast"), null);

      const event = new (win as any).KeyboardEvent("keydown", { key: "Escape", bubbles: true });
      win.document.dispatchEvent(event);

      assert.equal(win.document.querySelector(".tabi-premium-toast"), null);
    });
  });
});

describe("resolveSettings isPremium", () => {
  // isPremium integrates into resolveSettings like other settings fields
  it("defaults to false and can be overridden", async () => {
    const { resolveSettings, DEFAULTS } = await import("../src/types.js");

    // Base: default is false
    assert.equal(DEFAULTS.isPremium, false);
    assert.equal(resolveSettings({}).isPremium, false);

    // Delta: storage override sets it to true
    assert.equal(resolveSettings({ isPremium: true }).isPremium, true);

    // Explicit undefined does not clobber default
    assert.equal(resolveSettings({ isPremium: undefined }).isPremium, false);
  });
});
