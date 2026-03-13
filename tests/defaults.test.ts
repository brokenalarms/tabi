import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DEFAULTS, resolveSettings } from "../src/types.js";

describe("resolveSettings", () => {
  // Empty storage should produce all default values
  it("uses DEFAULTS when storage is empty", () => {
    const resolved = resolveSettings({});
    assert.deepStrictEqual(resolved, DEFAULTS);
  });

  // Stored values should override DEFAULTS
  it("overrides DEFAULTS with stored values", () => {
    const resolved = resolveSettings({ theme: "dark", keyBindingMode: "character" });
    assert.equal(resolved.theme, "dark");
    assert.equal(resolved.keyBindingMode, "character");
  });

  // Explicit undefined from storage should not clobber DEFAULTS
  it("ignores undefined storage values", () => {
    const resolved = resolveSettings({ theme: undefined, keyBindingMode: undefined });
    assert.equal(resolved.theme, "auto");
    assert.equal(resolved.keyBindingMode, "location");
  });
});
