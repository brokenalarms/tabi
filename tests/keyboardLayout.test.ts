import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { KB_ROWS, PRESETS } from "../src/keybindings";

// Maps event.code to display key — mirrors CODE_TO_DISPLAY in settings.ts
function codeToKey(code: string): string | null {
  if (code.startsWith("Key")) return code.slice(3).toLowerCase();
  const map: Record<string, string> = {
    Semicolon: ";", Period: ".", Comma: ",", Slash: "/",
    Quote: "'", BracketLeft: "[", BracketRight: "]",
  };
  return map[code] ?? null;
}

describe("Keyboard layout visualization", () => {
  const allKeys = KB_ROWS.flat().filter((k): k is string => k !== null);

  it("all rows have equal length forming a filled rectangle", () => {
    assert.ok(KB_ROWS.length >= 3, "should have at least 3 rows");
    const widths = KB_ROWS.map((row) => row.length);
    const allSame = widths.every((w) => w === widths[0]);
    assert.ok(allSame, `row widths differ: ${widths.join(", ")} — must form a rectangle`);
  });

  it("pads shorter rows with null spacers at the end", () => {
    const topNulls = KB_ROWS[0].filter((k) => k === null).length;
    assert.equal(topNulls, 0, "top row should have no spacers (defines width)");

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

  it("real keys are single printable characters", () => {
    for (const key of allKeys) {
      assert.equal(key.length, 1, `key "${key}" should be a single character`);
    }
  });

  // The full QWERTY layout includes brackets and quote — not just the 10 home keys
  it("includes all QWERTY keys including brackets and quote", () => {
    const expected = "qwertyuiop[]asdfghjkl;'zxcvbnm,./".split("");
    for (const key of expected) {
      assert.ok(allKeys.includes(key), `missing key: "${key}"`);
    }
  });

  // Every single-key binding across all presets resolves to a key in KB_ROWS
  it("every preset binding maps to a key present in KB_ROWS", () => {
    for (const [name, preset] of Object.entries(PRESETS)) {
      for (const binding of preset.bindings) {
        const codes = binding.sequence.split(" ");
        for (const raw of codes) {
          const code = raw.replace(/^Shift-/, "");
          const key = codeToKey(code);
          if (key) {
            assert.ok(
              allKeys.includes(key),
              `${name}: binding "${binding.display}" uses key "${key}" (from ${code}) not in KB_ROWS`
            );
          }
        }
      }
    }
  });
});
