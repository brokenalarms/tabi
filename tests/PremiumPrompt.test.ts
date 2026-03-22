// PremiumPrompt tests — verifies the premium upgrade prompt shows the correct
// feature info, animates in/out, dismisses on backdrop click, and fires the
// onUpgrade callback.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createDOM, type DOMEnvironment } from "./helpers/dom";
import { PremiumPrompt, PREMIUM_FEATURES } from "../src/modules/PremiumPrompt";

describe("PremiumPrompt", () => {
  let env: DOMEnvironment;
  let prompt: PremiumPrompt;

  beforeEach(() => {
    env = createDOM();
    prompt = new PremiumPrompt();
  });

  afterEach(() => {
    prompt.dismiss();
    env.cleanup();
  });

  // Verifies that show() inserts the prompt into the DOM with the correct feature info.
  it("show renders overlay with feature name and description", () => {
    // Base: no prompt in DOM
    assert.equal(document.querySelector("[data-tabi-premium-prompt]"), null);

    // Delta: show the prompt
    prompt.show("statistics");

    const overlay = document.querySelector("[data-tabi-premium-prompt]");
    assert.ok(overlay !== null, "overlay should be in DOM");
    assert.ok(overlay!.textContent!.includes("Usage Statistics"));
    assert.ok(overlay!.textContent!.includes(PREMIUM_FEATURES.statistics.description));
  });

  // Verifies that the CTA button text is present.
  it("show includes upgrade CTA button", () => {
    prompt.show("quickmarks");

    const overlay = document.querySelector("[data-tabi-premium-prompt]");
    assert.ok(overlay!.textContent!.includes("Upgrade to Premium"));
  });

  // Verifies that the dismiss link is present.
  it("show includes dismiss link", () => {
    prompt.show("leftHand");

    const overlay = document.querySelector("[data-tabi-premium-prompt]");
    assert.ok(overlay!.textContent!.includes("Maybe later"));
  });

  // Verifies isVisible() tracks prompt state.
  it("isVisible tracks prompt state", () => {
    // Base: not visible
    assert.equal(prompt.isVisible(), false);

    // Delta: show makes it visible
    prompt.show("tabSearch");
    assert.equal(prompt.isVisible(), true);

    // Delta: dismiss makes it not visible
    prompt.dismiss();
    assert.equal(prompt.isVisible(), false);
  });

  // Verifies that dismiss() clears the prompt reference (DOM removal is async).
  it("dismiss clears the prompt reference", () => {
    prompt.show("statistics");
    assert.equal(prompt.isVisible(), true);

    prompt.dismiss();
    assert.equal(prompt.isVisible(), false);
  });

  // Verifies that show() replaces any existing prompt.
  it("show replaces existing prompt when called twice", () => {
    prompt.show("statistics");
    prompt.show("quickmarks");

    const overlays = document.querySelectorAll("[data-tabi-premium-prompt]");
    // The first overlay is being removed (async), so there could be 1-2 in DOM
    // But the prompt should show quickmarks content
    assert.equal(prompt.isVisible(), true);
    // The active overlay should show Quick Marks
    const lastOverlay = overlays[overlays.length - 1];
    assert.ok(lastOverlay!.textContent!.includes("Quick Marks"));
  });

  // Verifies that the onUpgrade callback fires when CTA is clicked.
  it("CTA button fires onUpgrade callback", () => {
    let upgraded = false;
    prompt.show("statistics", () => { upgraded = true; });

    // Find and click the CTA button
    const overlay = document.querySelector("[data-tabi-premium-prompt]");
    const buttons = overlay!.querySelectorAll("button");
    const cta = Array.from(buttons).find(b => b.textContent === "Upgrade to Premium");
    assert.ok(cta !== undefined, "CTA button should exist");

    cta!.click();
    assert.equal(upgraded, true, "onUpgrade callback should have fired");
    assert.equal(prompt.isVisible(), false, "prompt should dismiss after CTA click");
  });

  // Verifies that clicking "Maybe later" dismisses the prompt.
  it("dismiss link closes the prompt", () => {
    prompt.show("leftHand");

    const overlay = document.querySelector("[data-tabi-premium-prompt]");
    const buttons = overlay!.querySelectorAll("button");
    const dismissBtn = Array.from(buttons).find(b => b.textContent === "Maybe later");
    assert.ok(dismissBtn !== undefined);

    dismissBtn!.click();
    assert.equal(prompt.isVisible(), false);
  });

  // Verifies that clicking the backdrop dismisses the prompt.
  it("clicking backdrop dismisses the prompt", () => {
    prompt.show("rightHand");

    const overlay = document.querySelector("[data-tabi-premium-prompt]") as HTMLElement;
    assert.ok(overlay !== null);

    // Simulate click on the overlay itself (not the card)
    const clickEvent = new MouseEvent("click", { bubbles: true });
    Object.defineProperty(clickEvent, "target", { value: overlay });
    overlay.dispatchEvent(clickEvent);

    assert.equal(prompt.isVisible(), false);
  });

  // Verifies that show() with an unknown feature key does nothing.
  it("show with unknown feature key does nothing", () => {
    prompt.show("nonexistent");
    assert.equal(prompt.isVisible(), false);
    assert.equal(document.querySelector("[data-tabi-premium-prompt]"), null);
  });

  // Verifies that each registered feature has all required fields.
  it("all PREMIUM_FEATURES have name, icon, and description", () => {
    for (const [key, feature] of Object.entries(PREMIUM_FEATURES)) {
      assert.ok(feature.name.length > 0, `${key} should have a name`);
      assert.ok(feature.icon.length > 0, `${key} should have an icon`);
      assert.ok(feature.description.length > 0, `${key} should have a description`);
    }
  });
});
