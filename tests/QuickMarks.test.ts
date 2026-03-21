// QuickMarks unit tests — verifies mark storage helpers, modal mark mode
// with status bar feedback, discovery panel, and key capture that prevents
// conflicts with normal-mode commands.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createDOM, type DOMEnvironment } from "./helpers/dom";
import { loadMarks, saveMark, getMark, type Mark, type MarkMap } from "../src/modules/QuickMarks";

// --- Pure storage helper tests (no DOM needed) ---

describe("QuickMarks storage helpers", () => {
  // Verifies that loadMarks returns an empty object when storage has no marks.
  it("loadMarks returns empty map when storage is empty", () => {
    assert.deepEqual(loadMarks({}), {});
  });

  // Verifies that loadMarks extracts existing marks from storage.
  it("loadMarks extracts marks from storage", () => {
    const mark: Mark = { url: "https://example.com", scrollY: 100, title: "Example" };
    const stored = { quickMarks: { a: mark } };
    const result = loadMarks(stored);
    assert.deepEqual(result, { a: mark });
  });

  // Verifies that saveMark adds a new mark to the map immutably.
  it("saveMark adds a mark without mutating the original", () => {
    const original: MarkMap = {};
    const mark: Mark = { url: "https://test.com", scrollY: 50, title: "Test" };
    const updated = saveMark(original, "b", mark);

    // Original unchanged
    assert.deepEqual(original, {});
    // Updated has the new mark
    assert.deepEqual(updated.b, mark);
  });

  // Verifies that saveMark overwrites an existing mark at the same key.
  it("saveMark overwrites existing mark at same key", () => {
    const old: Mark = { url: "https://old.com", scrollY: 0, title: "Old" };
    const fresh: Mark = { url: "https://new.com", scrollY: 200, title: "New" };
    const map: MarkMap = { a: old };

    const updated = saveMark(map, "a", fresh);
    assert.deepEqual(updated.a, fresh);
  });

  // Verifies that getMark retrieves existing marks and returns undefined for unset ones.
  it("getMark retrieves set marks and returns undefined for unset", () => {
    const mark: Mark = { url: "https://x.com", scrollY: 42, title: "X" };
    const map: MarkMap = { c: mark };

    assert.deepEqual(getMark(map, "c"), mark);
    assert.equal(getMark(map, "z"), undefined);
  });
});

// --- Integration tests with browser shim ---

describe("QuickMarks class", () => {
  let env: DOMEnvironment;
  let storedData: Record<string, unknown>;
  let sentMessages: Array<Record<string, unknown>>;
  let commands: Map<string, () => void>;
  let currentMode: string;
  let modeKeyDelegate: ((event: KeyboardEvent) => boolean) | null;
  let activeInstance: { deactivate(): void; destroy(): void } | null;

  const fakeKeyHandler = {
    on(cmd: string, cb: () => void) { commands.set(cmd, cb); },
    off(cmd: string) { commands.delete(cmd); },
    setMode(mode: string) { currentMode = mode; },
    setModeKeyDelegate(handler: (event: KeyboardEvent) => boolean) {
      modeKeyDelegate = handler;
    },
    clearModeKeyDelegate() { modeKeyDelegate = null; },
  };

  beforeEach(() => {
    env = createDOM();
    commands = new Map();
    storedData = {};
    sentMessages = [];
    currentMode = "NORMAL";
    modeKeyDelegate = null;
    activeInstance = null;

    (globalThis as any).browser = {
      runtime: {
        async sendMessage(msg: Record<string, unknown>) {
          sentMessages.push(msg);
          return { status: "ok", sameTab: msg.url === "https://current.com" };
        },
      },
      storage: {
        local: {
          async get(_keys: string[]) { return { ...storedData }; },
          async set(items: Record<string, unknown>) {
            Object.assign(storedData, items);
          },
        },
      },
    };
  });

  afterEach(() => {
    if (activeInstance) {
      activeInstance.destroy();
      activeInstance = null;
    }
    env.cleanup();
    delete (globalThis as any).browser;
  });

  // Verifies that QuickMarks registers setMark and jumpMark commands.
  it("registers setMark and jumpMark commands", async () => {
    const { QuickMarks } = await import("../src/modules/QuickMarks");
    activeInstance = new QuickMarks(fakeKeyHandler as any);

    assert.equal(commands.has("setMark"), true);
    assert.equal(commands.has("jumpMark"), true);
  });

  // Verifies that activating set mark mode enters MARK mode and shows status bar.
  it("setMark enters MARK mode and shows status bar", async () => {
    const { QuickMarks } = await import("../src/modules/QuickMarks");
    activeInstance = new QuickMarks(fakeKeyHandler as any);

    // Trigger setMark command
    await commands.get("setMark")!();

    assert.equal(currentMode, "MARK");
    assert.notEqual(modeKeyDelegate, null);

    const bar = document.querySelector(".tabi-mark-mode-bar");
    assert.ok(bar, "status bar should appear");
    assert.match(bar!.textContent || "", /Set mark/);
  });

  // Verifies that typing a letter in set mark mode saves the mark and exits.
  it("typing a letter in set mark mode saves mark and exits", async () => {
    const { QuickMarks } = await import("../src/modules/QuickMarks");
    activeInstance = new QuickMarks(fakeKeyHandler as any);

    await commands.get("setMark")!();

    // Simulate typing 'a'
    const event = new KeyboardEvent("keydown", {
      code: "KeyA", key: "a", bubbles: true, cancelable: true,
    });
    const handled = modeKeyDelegate!(event);

    assert.equal(handled, true);

    // Allow async setMark to complete
    await new Promise(r => setTimeout(r, 10));

    // Mark should be persisted
    const marks = storedData.quickMarks as Record<string, unknown>;
    assert.ok(marks);
    const mark = marks.a as Mark;
    assert.equal(mark.url, "https://localhost/");

    // Mode should return to NORMAL
    assert.equal(currentMode, "NORMAL");
  });

  // Verifies that mark mode captures non-letter keys without leaking them.
  it("non-letter keys are consumed but do not set a mark", async () => {
    const { QuickMarks } = await import("../src/modules/QuickMarks");
    activeInstance = new QuickMarks(fakeKeyHandler as any);

    await commands.get("setMark")!();

    // Simulate pressing 't' as a key code (which is a letter — this should work)
    const tEvent = new KeyboardEvent("keydown", {
      code: "KeyT", key: "t", bubbles: true, cancelable: true,
    });
    // But first, simulate pressing a number key (should be consumed but not act)
    const numEvent = new KeyboardEvent("keydown", {
      code: "Digit1", key: "1", bubbles: true, cancelable: true,
    });
    const handled = modeKeyDelegate!(numEvent);
    assert.equal(handled, true, "non-letter keys should be consumed");

    // Mode should still be MARK — no mark was set
    assert.equal(currentMode, "MARK");
  });

  // Verifies that Escape is not consumed (falls through to KeyHandler for exitToNormal).
  it("Escape falls through to KeyHandler for mode exit", async () => {
    const { QuickMarks } = await import("../src/modules/QuickMarks");
    activeInstance = new QuickMarks(fakeKeyHandler as any);

    await commands.get("setMark")!();

    const escEvent = new KeyboardEvent("keydown", {
      code: "Escape", key: "Escape", bubbles: true, cancelable: true,
    });
    const handled = modeKeyDelegate!(escEvent);
    assert.equal(handled, false, "Escape should not be consumed by mark mode");
  });

  // Verifies that jumpMark enters MARK mode with jump status.
  it("jumpMark enters MARK mode and shows jump status", async () => {
    const { QuickMarks } = await import("../src/modules/QuickMarks");
    activeInstance = new QuickMarks(fakeKeyHandler as any);

    await commands.get("jumpMark")!();

    assert.equal(currentMode, "MARK");
    const bar = document.querySelector(".tabi-mark-mode-bar");
    assert.ok(bar);
    assert.match(bar!.textContent || "", /Jump to mark/);
  });

  // Verifies that typing a letter in jump mode sends jumpToMark message.
  it("typing a letter in jump mode jumps to mark", async () => {
    const { QuickMarks } = await import("../src/modules/QuickMarks");
    activeInstance = new QuickMarks(fakeKeyHandler as any);

    storedData.quickMarks = {
      b: { url: "https://target.com/page", scrollY: 300, title: "Target" },
    };

    await commands.get("jumpMark")!();
    modeKeyDelegate!(new KeyboardEvent("keydown", {
      code: "KeyB", key: "b", bubbles: true, cancelable: true,
    }));

    await new Promise(r => setTimeout(r, 10));

    assert.equal(sentMessages.length, 1);
    assert.equal(sentMessages[0].command, "jumpToMark");
    assert.equal(sentMessages[0].url, "https://target.com/page");
    assert.equal(sentMessages[0].scrollY, 300);
    assert.equal(currentMode, "NORMAL");
  });

  // Verifies that jumping to an unset mark shows feedback without sending message.
  it("jumping to unset mark shows feedback without sending message", async () => {
    const { QuickMarks } = await import("../src/modules/QuickMarks");
    activeInstance = new QuickMarks(fakeKeyHandler as any);

    await commands.get("jumpMark")!();
    modeKeyDelegate!(new KeyboardEvent("keydown", {
      code: "KeyZ", key: "z", bubbles: true, cancelable: true,
    }));

    await new Promise(r => setTimeout(r, 10));

    assert.equal(sentMessages.length, 0);

    // Status bar should show "not set" feedback
    const bars = document.querySelectorAll(".tabi-mark-mode-bar");
    const lastBar = bars[bars.length - 1];
    assert.ok(lastBar);
    assert.match(lastBar!.textContent || "", /not set/);
  });

  // Verifies that deactivate cleans up all DOM elements and resets mode.
  it("deactivate removes status bar and returns to NORMAL", async () => {
    const { QuickMarks } = await import("../src/modules/QuickMarks");
    const qm = activeInstance = new QuickMarks(fakeKeyHandler as any);

    await commands.get("setMark")!();
    assert.equal(currentMode, "MARK");

    qm.deactivate();

    assert.equal(currentMode, "NORMAL");
    assert.equal(modeKeyDelegate, null);
    assert.equal(document.querySelector(".tabi-mark-mode-bar"), null);
  });

  // Verifies that destroy unregisters commands.
  it("destroy unregisters commands", async () => {
    const { QuickMarks } = await import("../src/modules/QuickMarks");
    const qm = activeInstance = new QuickMarks(fakeKeyHandler as any);

    assert.equal(commands.has("setMark"), true);
    qm.destroy();
    assert.equal(commands.has("setMark"), false);
    assert.equal(commands.has("jumpMark"), false);
  });

  // Verifies that the discovery panel appears after the delay timer.
  it("discovery panel shows saved marks after delay", async () => {
    const { QuickMarks } = await import("../src/modules/QuickMarks");
    activeInstance = new QuickMarks(fakeKeyHandler as any);

    storedData.quickMarks = {
      a: { url: "https://example.com", scrollY: 0, title: "Example" },
      c: { url: "https://test.com", scrollY: 100, title: "Test Page" },
    };

    await commands.get("jumpMark")!();

    // Panel should not be visible yet
    assert.equal(document.querySelector(".tabi-mark-panel"), null);

    // Wait for panel delay (MARK_PANEL_DELAY_MS = 400)
    await new Promise(r => setTimeout(r, 450));

    const panel = document.querySelector(".tabi-mark-panel");
    assert.ok(panel, "discovery panel should appear after delay");

    const items = panel!.querySelectorAll(".tabi-tab-search-item");
    assert.equal(items.length, 2, "panel should show 2 saved marks");

    const labels = panel!.querySelectorAll(".tabi-mark-label");
    assert.equal(labels[0]!.textContent, "a");
    assert.equal(labels[1]!.textContent, "c");
  });

  // Verifies that fast typing (before panel delay) does not show the panel.
  it("fast path: typing before delay skips panel", async () => {
    const { QuickMarks } = await import("../src/modules/QuickMarks");
    activeInstance = new QuickMarks(fakeKeyHandler as any);

    await commands.get("setMark")!();

    // Type immediately
    modeKeyDelegate!(new KeyboardEvent("keydown", {
      code: "KeyA", key: "a", bubbles: true, cancelable: true,
    }));

    await new Promise(r => setTimeout(r, 10));

    // Panel should never appear
    assert.equal(document.querySelector(".tabi-mark-panel"), null);
  });
});
