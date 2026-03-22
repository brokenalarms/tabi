import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { KB_ROWS } from "../src/keybindings";

describe("Keyboard layout visualization", () => {
  // All rows must have the same number of cells to form a filled rectangle
  it("all rows have equal length forming a rectangle", () => {
    assert.ok(KB_ROWS.length >= 3, "should have at least 3 rows");
    const widths = KB_ROWS.map((row) => row.length);
    const allSame = widths.every((w) => w === widths[0]);
    assert.ok(allSame, `row widths differ: ${widths.join(", ")} — must form a rectangle`);
  });

  // Shorter keyboard rows use null spacers to pad to the rectangle width
  it("pads shorter rows with null spacers at the end", () => {
    // Top row defines the natural width — no padding needed
    const topNulls = KB_ROWS[0].filter((k) => k === null).length;
    assert.equal(topNulls, 0, "top row should have no spacers (defines width)");

    // Each subsequent row has progressively more trailing spacers
    for (let i = 1; i < KB_ROWS.length; i++) {
      const row = KB_ROWS[i];
      const lastRealIndex = row.findLastIndex((k) => k !== null);
      const trailingNulls = row.slice(lastRealIndex + 1);
      assert.ok(
        trailingNulls.length > 0 && trailingNulls.every((k) => k === null),
        `row ${i} should have trailing null spacers`
      );
    }
  });

  // Every real key should be a single printable character
  it("real keys are single printable characters", () => {
    for (const row of KB_ROWS) {
      for (const key of row) {
        if (key !== null) {
          assert.equal(key.length, 1, `key "${key}" should be a single character`);
        }
      }
    }
  });

  // The three QWERTY rows should contain all expected keys
  it("contains all QWERTY letter and punctuation keys", () => {
    const allKeys = KB_ROWS.flat().filter((k): k is string => k !== null);
    const expected = "qwertyuiop[]asdfghjkl;'zxcvbnm,./".split("");
    for (const key of expected) {
      assert.ok(allKeys.includes(key), `missing key: ${key}`);
    }
  });
});
