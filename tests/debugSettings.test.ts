import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolvePremiumStatus } from "../src/types.js";

describe("resolvePremiumStatus", () => {
  // In debug mode, premium defaults to true when no override is stored
  it("defaults to premium in debug mode", () => {
    assert.equal(resolvePremiumStatus({}, true), true);
  });

  // In debug mode, the debugPremium storage key overrides the default
  it("respects debugPremium override in debug mode", () => {
    // Base: defaults to true
    assert.equal(resolvePremiumStatus({}, true), true);

    // Delta: explicit false disables premium
    assert.equal(resolvePremiumStatus({ debugPremium: false }, true), false);

    // Delta: explicit true keeps premium
    assert.equal(resolvePremiumStatus({ debugPremium: true }, true), true);
  });

  // In debug mode, the regular isPremium key is ignored
  it("ignores isPremium storage key in debug mode", () => {
    assert.equal(resolvePremiumStatus({ isPremium: false }, true), true);
    assert.equal(resolvePremiumStatus({ isPremium: true, debugPremium: false }, true), false);
  });

  // Outside debug mode, falls back to isPremium from storage
  it("uses isPremium from storage in non-debug mode", () => {
    // Base: defaults to false
    assert.equal(resolvePremiumStatus({}, false), false);

    // Delta: stored isPremium enables premium
    assert.equal(resolvePremiumStatus({ isPremium: true }, false), true);
  });

  // Outside debug mode, debugPremium key is ignored
  it("ignores debugPremium in non-debug mode", () => {
    assert.equal(resolvePremiumStatus({ debugPremium: true }, false), false);
    assert.equal(resolvePremiumStatus({ debugPremium: true, isPremium: false }, false), false);
  });
});
