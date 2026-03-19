// QuickMarks unit tests — verifies mark storage helpers and that the
// QuickMarks class correctly wires set/jump commands, persists marks to
// browser.storage.local, and shows toast feedback.

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

  const fakeKeyHandler = {
    on(cmd: string, cb: () => void) { commands.set(cmd, cb); },
    off(cmd: string) { commands.delete(cmd); },
  };

  beforeEach(() => {
    env = createDOM();
    commands = new Map();
    storedData = {};
    sentMessages = [];

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
    env.cleanup();
    delete (globalThis as any).browser;
  });

  // Verifies that QuickMarks registers set and jump commands for all 26 letters.
  it("registers setMark_a-z and jumpMark_a-z commands", async () => {
    const { QuickMarks } = await import("../src/modules/QuickMarks");
    new QuickMarks(fakeKeyHandler);

    assert.equal(commands.has("setMark_a"), true);
    assert.equal(commands.has("setMark_z"), true);
    assert.equal(commands.has("jumpMark_a"), true);
    assert.equal(commands.has("jumpMark_z"), true);
    assert.equal(commands.has("setMark_0"), false); // Only a-z
  });

  // Verifies that setMark saves the current page's URL, scroll position, and title.
  it("setMark persists mark to storage", async () => {
    const { QuickMarks } = await import("../src/modules/QuickMarks");
    const qm = new QuickMarks(fakeKeyHandler);

    await qm.setMark("a");

    const marks = storedData.quickMarks as Record<string, unknown>;
    assert.ok(marks);
    const mark = marks.a as { url: string; scrollY: number; title: string };
    assert.equal(mark.url, "https://localhost/");
    assert.equal(typeof mark.scrollY, "number");
    assert.equal(typeof mark.title, "string");
  });

  // Verifies that jumpToMark sends a jumpToMark message to the background.
  it("jumpToMark sends message to background with mark URL", async () => {
    const { QuickMarks } = await import("../src/modules/QuickMarks");
    const qm = new QuickMarks(fakeKeyHandler);

    // Pre-populate a mark
    storedData.quickMarks = {
      b: { url: "https://target.com/page", scrollY: 300, title: "Target" },
    };

    await qm.jumpToMark("b");

    assert.equal(sentMessages.length, 1);
    assert.equal(sentMessages[0].command, "jumpToMark");
    assert.equal(sentMessages[0].url, "https://target.com/page");
    assert.equal(sentMessages[0].scrollY, 300);
  });

  // Verifies that jumping to an unset mark shows a "not set" toast without messaging background.
  it("jumpToMark for unset mark shows toast without sending message", async () => {
    const { QuickMarks } = await import("../src/modules/QuickMarks");
    const qm = new QuickMarks(fakeKeyHandler);

    await qm.jumpToMark("z");

    // No message sent to background
    assert.equal(sentMessages.length, 0);
    // Toast is visible
    const toast = document.querySelector("[data-tabi-toast]");
    assert.ok(toast);
    assert.match(toast!.textContent || "", /not set/);
  });

  // Verifies that setMark shows a confirmation toast.
  it("setMark shows a toast", async () => {
    const { QuickMarks } = await import("../src/modules/QuickMarks");
    const qm = new QuickMarks(fakeKeyHandler);

    await qm.setMark("d");

    const toast = document.querySelector("[data-tabi-toast]");
    assert.ok(toast);
    assert.match(toast!.textContent || "", /Mark 'd' set/);
  });

  // Verifies that destroy unregisters all commands.
  it("destroy unregisters all commands", async () => {
    const { QuickMarks } = await import("../src/modules/QuickMarks");
    const qm = new QuickMarks(fakeKeyHandler);

    assert.equal(commands.has("setMark_a"), true);
    qm.destroy();
    assert.equal(commands.has("setMark_a"), false);
    assert.equal(commands.has("jumpMark_a"), false);
  });
});
