import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DEFAULTS, resolveSettings } from "../src/types.js";
import { PRESETS, bindingsForPreset, isLayoutPremium } from "../src/keybindings.js";

describe("resolveSettings", () => {
  // Empty storage should produce all default values
  it("uses DEFAULTS when storage is empty", () => {
    const resolved = resolveSettings({});
    assert.deepStrictEqual(resolved, DEFAULTS);
  });

  // Stored values should override DEFAULTS
  it("overrides DEFAULTS with stored values", () => {
    const resolved = resolveSettings({ theme: "dark", keyBindingMode: "character", keyLayout: "vim" });
    assert.equal(resolved.theme, "dark");
    assert.equal(resolved.keyBindingMode, "character");
    assert.equal(resolved.keyLayout, "vim");
  });

  // Explicit undefined from storage should not clobber DEFAULTS
  it("ignores undefined storage values", () => {
    const resolved = resolveSettings({ theme: undefined, keyBindingMode: undefined, keyLayout: undefined });
    assert.equal(resolved.theme, "auto");
    assert.equal(resolved.keyBindingMode, "location");
    assert.equal(resolved.keyLayout, "optimized");
  });

  // keyLayout defaults to "optimized" for new users
  it("defaults keyLayout to optimized", () => {
    const resolved = resolveSettings({});
    assert.equal(resolved.keyLayout, "optimized");
  });
});

describe("Key layouts", () => {
  // Premium gating: leftHand and rightHand are premium, optimized and vim are free
  it("gates leftHand and rightHand behind premium", () => {
    assert.equal(isLayoutPremium("optimized"), false);
    assert.equal(isLayoutPremium("vim"), false);
    assert.equal(isLayoutPremium("leftHand"), true);
    assert.equal(isLayoutPremium("rightHand"), true);
  });

  // All four layouts should have non-empty bindings
  it("all layouts have bindings", () => {
    for (const layout of ["optimized", "vim", "leftHand", "rightHand"] as const) {
      const bindings = bindingsForPreset(layout);
      assert.ok(bindings.length > 0, `${layout} should have bindings`);
    }
  });

  // leftHand layout uses WASD for scrolling instead of HJKL
  it("leftHand uses WASD for scrolling", () => {
    const bindings = new Map(bindingsForPreset("leftHand"));
    assert.equal(bindings.get("KeyW"), "scrollUp");
    assert.equal(bindings.get("KeyS"), "scrollDown");
    assert.equal(bindings.get("KeyA"), "scrollLeft");
    assert.equal(bindings.get("KeyD"), "scrollRight");
  });

  // rightHand layout uses H for hint activation (action column toward center)
  it("rightHand uses H for activateHints", () => {
    const bindings = new Map(bindingsForPreset("rightHand"));
    assert.equal(bindings.get("KeyH"), "activateHints");
  });

  // All layouts must include setMark and jumpMark so marks work everywhere.
  // rightHand previously used KeyM for yankLink, blocking marks entirely.
  it("all layouts include mark bindings", () => {
    for (const layout of ["optimized", "vim", "leftHand", "rightHand"] as const) {
      const commands = new Set(bindingsForPreset(layout).map(([, cmd]) => cmd));
      assert.ok(commands.has("setMark"), `${layout} should have setMark`);
      assert.ok(commands.has("jumpMark"), `${layout} should have jumpMark`);
    }
  });

  // All preset bindings are single keystroke or Shift+key — no multi-key sequences
  it("no multi-key sequences in any layout", () => {
    for (const layout of ["optimized", "vim", "leftHand", "rightHand"] as const) {
      const bindings = bindingsForPreset(layout);
      for (const [seq] of bindings) {
        assert.ok(!seq.includes(" "), `${layout}: "${seq}" is a multi-key sequence`);
      }
    }
  });

  // No layout should bind the same key sequence to two different commands.
  it("no duplicate key sequences within any layout", () => {
    for (const layout of ["optimized", "vim", "leftHand", "rightHand"] as const) {
      const bindings = bindingsForPreset(layout);
      const seen = new Map<string, string>();
      for (const [seq, cmd] of bindings) {
        assert.ok(!seen.has(seq), `${layout}: "${seq}" bound to both "${seen.get(seq)}" and "${cmd}"`);
        seen.set(seq, cmd);
      }
    }
  });
});
