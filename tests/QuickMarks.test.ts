// QuickMarks unit tests — verifies mark storage helpers, URL matching,
// two-character label support with Enter confirmation, jump debounce,
// favicon storage, improved confirmation UX, and discovery panel.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createDOM, type DOMEnvironment } from "./helpers/dom";
import {
  loadMarks, saveMark, getMark, summarizeUrl, urlOriginPath, loadSettings,
  type Mark, type MarkMap,
} from "../src/modules/QuickMarks";

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

    assert.deepEqual(original, {});
    assert.deepEqual(updated.b, mark);
  });

  // Verifies that saveMark works with two-character labels.
  it("saveMark supports two-character labels", () => {
    const mark: Mark = { url: "https://gh.com", scrollY: 0, title: "GH" };
    const updated = saveMark({}, "gh", mark);
    assert.deepEqual(updated.gh, mark);
    assert.deepEqual(getMark(updated, "gh"), mark);
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

  // Verifies that loadSettings returns defaults when no settings stored.
  it("loadSettings returns defaults when empty", () => {
    const settings = loadSettings({});
    assert.equal(settings.reuseTab, true);
  });

  // Verifies that loadSettings merges stored values over defaults.
  it("loadSettings merges stored values", () => {
    const settings = loadSettings({ quickMarkSettings: { reuseTab: false } });
    assert.equal(settings.reuseTab, false);
  });
});

// --- URL summary tests ---

describe("summarizeUrl", () => {
  it("returns host only for root URL", () => {
    assert.equal(summarizeUrl("https://github.com/"), "github.com");
    assert.equal(summarizeUrl("https://github.com"), "github.com");
  });

  it("strips www prefix", () => {
    assert.equal(summarizeUrl("https://www.example.com/page"), "example.com/page");
  });

  it("shows host/segment for single path segment", () => {
    assert.equal(summarizeUrl("https://github.com/ralph"), "github.com/ralph");
  });

  it("shows host/…/last for deep paths", () => {
    assert.equal(
      summarizeUrl("https://github.com/user/repo/pulls"),
      "github.com/\u2026/pulls",
    );
    assert.equal(
      summarizeUrl("https://amazon.com/dp/B08N5WRWNW/checkout"),
      "amazon.com/\u2026/checkout",
    );
  });

  it("ignores trailing slash", () => {
    assert.equal(
      summarizeUrl("https://github.com/user/repo/"),
      "github.com/\u2026/repo",
    );
  });

  it("returns raw string for invalid URL", () => {
    assert.equal(summarizeUrl("not-a-url"), "not-a-url");
  });
});

// --- URL matching tests ---

describe("urlOriginPath", () => {
  // Verifies query params and hash are stripped for URL matching
  it("strips query params and hash", () => {
    assert.equal(
      urlOriginPath("https://github.com/user/repo/pulls?q=is%3Apr"),
      "https://github.com/user/repo/pulls",
    );
    assert.equal(
      urlOriginPath("https://example.com/page#section"),
      "https://example.com/page",
    );
  });

  // Verifies that a URL with no query/hash is returned as origin+pathname
  it("returns origin+pathname for clean URLs", () => {
    assert.equal(
      urlOriginPath("https://github.com/user/repo"),
      "https://github.com/user/repo",
    );
  });

  // Verifies that mark URL matching works with startsWith for relaxed matching
  it("supports startsWith matching for relaxed URL comparison", () => {
    const markBase = urlOriginPath("https://github.com/brokenalarms/tabi/pulls");
    const tabUrl = urlOriginPath("https://github.com/brokenalarms/tabi/pulls?q=is%3Apr+is%3Aclosed");
    assert.equal(tabUrl.startsWith(markBase), true);
  });

  it("returns raw string for invalid URL", () => {
    assert.equal(urlOriginPath("not-a-url"), "not-a-url");
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

  function pressKey(key: string, code?: string): boolean {
    return modeKeyDelegate!(new KeyboardEvent("keydown", {
      code: code ?? `Key${key.toUpperCase()}`,
      key,
      bubbles: true,
      cancelable: true,
    }));
  }

  function pressEnter(): boolean {
    return modeKeyDelegate!(new KeyboardEvent("keydown", {
      code: "Enter", key: "Enter", bubbles: true, cancelable: true,
    }));
  }

  function pressBackspace(): boolean {
    return modeKeyDelegate!(new KeyboardEvent("keydown", {
      code: "Backspace", key: "Backspace", bubbles: true, cancelable: true,
    }));
  }

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

    await commands.get("setMark")!();

    assert.equal(currentMode, "MARK");
    assert.notEqual(modeKeyDelegate, null);

    const bar = document.querySelector(".tabi-mark-mode-bar");
    assert.ok(bar, "status bar should appear");
    assert.equal(bar!.textContent, "Set Mark:");
  });

  // Verifies that typing a letter shows it in the status bar with save prompt.
  it("typing a letter in set mode shows label with save prompt", async () => {
    const { QuickMarks } = await import("../src/modules/QuickMarks");
    activeInstance = new QuickMarks(fakeKeyHandler as any);

    await commands.get("setMark")!();
    pressKey("a");

    const bar = document.querySelector(".tabi-mark-mode-bar");
    assert.ok(bar);
    assert.equal(bar!.textContent, "Set Mark: a \u23ce save");
  });

  // Verifies that typing two letters shows the full label in status bar.
  it("typing two letters shows both in status bar", async () => {
    const { QuickMarks } = await import("../src/modules/QuickMarks");
    activeInstance = new QuickMarks(fakeKeyHandler as any);

    await commands.get("setMark")!();
    pressKey("g");
    pressKey("h");

    const bar = document.querySelector(".tabi-mark-mode-bar");
    assert.ok(bar);
    assert.equal(bar!.textContent, "Set Mark: gh \u23ce save");
  });

  // Verifies that Enter after typing a label saves the mark.
  it("Enter after label saves mark and shows confirmation", async () => {
    const { QuickMarks } = await import("../src/modules/QuickMarks");
    activeInstance = new QuickMarks(fakeKeyHandler as any);

    await commands.get("setMark")!();
    pressKey("a");
    pressEnter();

    await new Promise(r => setTimeout(r, 10));

    const marks = storedData.quickMarks as Record<string, unknown>;
    assert.ok(marks);
    const mark = marks.a as Mark;
    assert.equal(mark.url, "https://localhost/");
    assert.equal(currentMode, "NORMAL");
  });

  // Verifies that two-character marks can be saved with Enter.
  it("two-character mark labels are saved correctly", async () => {
    const { QuickMarks } = await import("../src/modules/QuickMarks");
    activeInstance = new QuickMarks(fakeKeyHandler as any);

    await commands.get("setMark")!();
    pressKey("g");
    pressKey("h");
    pressEnter();

    await new Promise(r => setTimeout(r, 10));

    const marks = storedData.quickMarks as Record<string, unknown>;
    assert.ok(marks);
    assert.ok(marks.gh);
  });

  // Verifies that Enter without any label does nothing.
  it("Enter without label does nothing", async () => {
    const { QuickMarks } = await import("../src/modules/QuickMarks");
    activeInstance = new QuickMarks(fakeKeyHandler as any);

    await commands.get("setMark")!();
    pressEnter();

    assert.equal(currentMode, "MARK", "should still be in MARK mode");
  });

  // Verifies that Backspace removes the last character from the label buffer.
  it("Backspace removes last character from label buffer", async () => {
    const { QuickMarks } = await import("../src/modules/QuickMarks");
    activeInstance = new QuickMarks(fakeKeyHandler as any);

    await commands.get("setMark")!();
    pressKey("g");
    pressKey("h");

    const bar = document.querySelector(".tabi-mark-mode-bar");
    assert.equal(bar!.textContent, "Set Mark: gh \u23ce save");

    pressBackspace();
    assert.equal(bar!.textContent, "Set Mark: g \u23ce save");

    pressBackspace();
    assert.equal(bar!.textContent, "Set Mark:");
  });

  // Verifies that set mark confirmation shows multi-line format with glow.
  it("setMark confirmation has multi-line format", async () => {
    const { QuickMarks } = await import("../src/modules/QuickMarks");
    activeInstance = new QuickMarks(fakeKeyHandler as any);

    await commands.get("setMark")!();
    pressKey("a");
    pressEnter();

    await new Promise(r => setTimeout(r, 10));

    const bar = document.querySelectorAll(".tabi-mark-mode-bar");
    const lastBar = bar[bar.length - 1];
    assert.ok(lastBar);
    assert.ok(lastBar.classList.contains("tabi-mode-bar-confirm"));
    const keyLine = lastBar.querySelector(".tabi-confirm-key");
    assert.ok(keyLine);
    assert.equal(keyLine!.textContent, "Set Mark: a — saved");
    const urlLine = lastBar.querySelector(".tabi-confirm-url");
    assert.ok(urlLine);
    assert.equal(urlLine!.textContent, "https://localhost/");
  });

  // Verifies that mark mode captures non-letter keys without leaking them.
  it("non-letter keys are consumed but do not set a mark", async () => {
    const { QuickMarks } = await import("../src/modules/QuickMarks");
    activeInstance = new QuickMarks(fakeKeyHandler as any);

    await commands.get("setMark")!();

    const numEvent = new KeyboardEvent("keydown", {
      code: "Digit1", key: "1", bubbles: true, cancelable: true,
    });
    const handled = modeKeyDelegate!(numEvent);
    assert.equal(handled, true, "non-letter keys should be consumed");
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
    assert.equal(bar!.textContent, "Jump to Mark:");
  });

  // Verifies that typing a letter in jump mode debounces then jumps.
  it("single char jump debounces then sends jumpToMark message", async () => {
    const { QuickMarks } = await import("../src/modules/QuickMarks");
    activeInstance = new QuickMarks(fakeKeyHandler as any);

    storedData.quickMarks = {
      b: { url: "https://target.com/page", scrollY: 300, title: "Target" },
    };

    await commands.get("jumpMark")!();
    pressKey("b");

    // Should not have sent message yet (debounce pending)
    assert.equal(sentMessages.length, 0);

    // Wait for debounce (MARK_JUMP_DEBOUNCE_MS = 300)
    await new Promise(r => setTimeout(r, 350));

    assert.equal(sentMessages.length, 1);
    assert.equal(sentMessages[0].command, "jumpToMark");
    assert.equal(sentMessages[0].url, "https://target.com/page");
    assert.equal(sentMessages[0].scrollY, 300);
    assert.equal(sentMessages[0].reuseTab, true);
    assert.equal(currentMode, "NORMAL");
  });

  // Verifies that two-char jump executes immediately without debounce.
  it("two-char jump label executes immediately", async () => {
    const { QuickMarks } = await import("../src/modules/QuickMarks");
    activeInstance = new QuickMarks(fakeKeyHandler as any);

    storedData.quickMarks = {
      gh: { url: "https://github.com", scrollY: 0, title: "GitHub" },
    };

    await commands.get("jumpMark")!();
    pressKey("g");
    pressKey("h");

    await new Promise(r => setTimeout(r, 10));

    assert.equal(sentMessages.length, 1);
    assert.equal(sentMessages[0].url, "https://github.com");
    assert.equal(currentMode, "NORMAL");
  });

  // Verifies that jumpToMark passes reuseTab setting.
  it("jump sends reuseTab from settings", async () => {
    const { QuickMarks } = await import("../src/modules/QuickMarks");
    activeInstance = new QuickMarks(fakeKeyHandler as any);

    storedData.quickMarks = {
      a: { url: "https://example.com", scrollY: 0, title: "Ex" },
    };
    storedData.quickMarkSettings = { reuseTab: false };

    await commands.get("jumpMark")!();
    pressKey("a");

    await new Promise(r => setTimeout(r, 350));

    assert.equal(sentMessages[0].reuseTab, false);
  });

  // Verifies that jumping to an unset mark shows feedback without sending message.
  it("jumping to unset mark shows feedback without sending message", async () => {
    const { QuickMarks } = await import("../src/modules/QuickMarks");
    activeInstance = new QuickMarks(fakeKeyHandler as any);

    await commands.get("jumpMark")!();
    pressKey("z");

    await new Promise(r => setTimeout(r, 350));

    assert.equal(sentMessages.length, 0);

    const bars = document.querySelectorAll(".tabi-mark-mode-bar");
    const lastBar = bars[bars.length - 1];
    assert.ok(lastBar);
    const keyLine = lastBar.querySelector(".tabi-confirm-key");
    assert.ok(keyLine);
    assert.equal(keyLine!.textContent, "Jump to Mark: z — not set");
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
  it("discovery panel shows saved marks with favicons after delay", async () => {
    const { QuickMarks } = await import("../src/modules/QuickMarks");
    activeInstance = new QuickMarks(fakeKeyHandler as any);

    storedData.quickMarks = {
      a: { url: "https://example.com", scrollY: 0, title: "Example", favicon: "https://example.com/icon.png" },
      c: { url: "https://test.com", scrollY: 100, title: "Test Page" },
    };

    await commands.get("jumpMark")!();

    assert.equal(document.querySelector(".tabi-mark-panel"), null);

    await new Promise(r => setTimeout(r, 450));

    const panel = document.querySelector(".tabi-mark-panel");
    assert.ok(panel, "discovery panel should appear after delay");

    const items = panel!.querySelectorAll(".tabi-tab-search-item");
    assert.equal(items.length, 2, "panel should show 2 saved marks");

    const labels = panel!.querySelectorAll(".tabi-mark-label");
    assert.equal(labels[0]!.textContent, "a");
    assert.equal(labels[1]!.textContent, "c");

    // First mark has a favicon
    const favicons = panel!.querySelectorAll(".tabi-tab-search-favicon");
    assert.equal(favicons.length, 1);
    assert.equal((favicons[0] as HTMLImageElement).src, "https://example.com/icon.png");
  });

  // Verifies that the discovery panel header reflects two-char label support.
  it("discovery panel header mentions label, not a-z", async () => {
    const { QuickMarks } = await import("../src/modules/QuickMarks");
    activeInstance = new QuickMarks(fakeKeyHandler as any);

    await commands.get("setMark")!();

    await new Promise(r => setTimeout(r, 450));

    const header = document.querySelector(".tabi-mark-panel-header");
    assert.ok(header);
    assert.ok(header!.textContent!.includes("label"));
  });

  // Verifies that fast typing (before panel delay) does not show the panel.
  it("fast path: typing before delay skips panel", async () => {
    const { QuickMarks } = await import("../src/modules/QuickMarks");
    activeInstance = new QuickMarks(fakeKeyHandler as any);

    await commands.get("setMark")!();

    pressKey("a");
    pressEnter();

    await new Promise(r => setTimeout(r, 10));

    assert.equal(document.querySelector(".tabi-mark-panel"), null);
  });

  // Verifies that favicon from the current page is captured when setting a mark.
  it("setMark captures favicon from page link element", async () => {
    const { QuickMarks } = await import("../src/modules/QuickMarks");
    activeInstance = new QuickMarks(fakeKeyHandler as any);

    // Add a favicon link element
    const link = document.createElement("link");
    link.rel = "icon";
    link.href = "https://localhost/favicon.ico";
    document.head.appendChild(link);

    await commands.get("setMark")!();
    pressKey("a");
    pressEnter();

    await new Promise(r => setTimeout(r, 10));

    const marks = storedData.quickMarks as Record<string, Mark>;
    assert.ok(marks.a);
    assert.equal(marks.a.favicon, "https://localhost/favicon.ico");

    document.head.removeChild(link);
  });
});
