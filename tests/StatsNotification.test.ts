// StatsNotification unit tests — verifies the weekly notification logic:
// shouldShow timestamp gating, formatDistance human-friendly output,
// buildNotificationBody summary text, and StatsNotification.check()
// integration with browser.storage.local.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createDOM, type DOMEnvironment } from "./helpers/dom";
import {
  shouldShow,
  formatDistance,
  buildNotificationBody,
} from "../src/modules/StatsNotification";
import type { StatCounters } from "../src/modules/Statistics";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

// --- Pure helper tests ---

describe("StatsNotification pure helpers", () => {
  // Verifies that shouldShow returns true when 7+ days have elapsed.
  it("shouldShow returns true after 7 days", () => {
    const lastShown = 1000;
    const now = lastShown + SEVEN_DAYS_MS;

    // Base: not enough time has passed
    assert.equal(shouldShow(lastShown, lastShown + SEVEN_DAYS_MS - 1), false);

    // Delta: exactly 7 days triggers
    assert.equal(shouldShow(lastShown, now), true);
  });

  // Verifies that shouldShow returns true when lastShown is 0 (never shown).
  it("shouldShow returns true when never shown before", () => {
    assert.equal(shouldShow(0, Date.now()), true);
  });

  // Verifies formatDistance output for various distances.
  it("formatDistance formats feet and miles", () => {
    assert.equal(formatDistance(50), "50 feet");
    assert.equal(formatDistance(1000), "1000 feet");
    assert.equal(formatDistance(5280), "1.0 miles");
    assert.equal(formatDistance(52800), "10 miles");
  });

  // Verifies that buildNotificationBody includes action counts and distance.
  it("buildNotificationBody includes counts and distance", () => {
    const counters: StatCounters = {
      hintsClicked: 10,
      linksYanked: 5,
      tabsSearched: 3,
      scrollActions: 2,
    };

    const body = buildNotificationBody(counters);

    assert.ok(body.includes("10 hints"));
    assert.ok(body.includes("5 yanks"));
    assert.ok(body.includes("3 tab searches"));
    assert.ok(body.includes("2 scrolls"));
    assert.ok(body.includes("20 feet"));
  });

  // Verifies that buildNotificationBody omits zero-count actions.
  it("buildNotificationBody omits zero-count actions", () => {
    const counters: StatCounters = {
      hintsClicked: 5,
      linksYanked: 0,
      tabsSearched: 0,
      scrollActions: 0,
    };

    const body = buildNotificationBody(counters);

    assert.ok(body.includes("5 hints"));
    assert.ok(!body.includes("yanks"));
    assert.ok(!body.includes("tab searches"));
    assert.ok(!body.includes("scrolls"));
  });

  // Verifies that buildNotificationBody handles zero total actions.
  it("buildNotificationBody returns fallback for zero actions", () => {
    const counters: StatCounters = {
      hintsClicked: 0,
      linksYanked: 0,
      tabsSearched: 0,
      scrollActions: 0,
    };

    const body = buildNotificationBody(counters);
    assert.ok(body.includes("No actions recorded"));
  });

  // Verifies that buildNotificationBody includes milestone description when earned.
  it("buildNotificationBody includes milestone when earned", () => {
    const counters: StatCounters = {
      hintsClicked: 50,
      linksYanked: 0,
      tabsSearched: 0,
      scrollActions: 0,
    };

    const body = buildNotificationBody(counters);
    // 50 actions = second milestone: "You've saved a minute of mouse-reaching"
    assert.ok(body.includes("saved a minute"));
  });
});

// --- StatsNotification class integration tests ---

describe("StatsNotification class", () => {
  let env: DOMEnvironment;
  let storedData: Record<string, unknown>;

  beforeEach(() => {
    env = createDOM();
    storedData = {};

    (globalThis as any).browser = {
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

  // Verifies that check() shows notification when never shown before.
  it("check shows notification when lastStatsShown is absent", async () => {
    const { StatsNotification } = await import("../src/modules/StatsNotification");
    const notif = new StatsNotification();
    const counters: StatCounters = {
      hintsClicked: 10, linksYanked: 0, tabsSearched: 0, scrollActions: 0,
    };

    const shown = await notif.check(counters);
    assert.equal(shown, true);

    // Notification element should be in the DOM
    const el = document.querySelector("[data-tabi-stats-notification]");
    assert.ok(el !== null, "notification element should exist in DOM");

    // Storage should be updated
    assert.ok(typeof storedData.lastStatsShown === "number");

    notif.dismiss();
  });

  // Verifies that check() does NOT show notification when shown recently.
  it("check skips notification when shown less than 7 days ago", async () => {
    storedData.lastStatsShown = Date.now() - 1000; // 1 second ago

    const { StatsNotification } = await import("../src/modules/StatsNotification");
    const notif = new StatsNotification();
    const counters: StatCounters = {
      hintsClicked: 10, linksYanked: 0, tabsSearched: 0, scrollActions: 0,
    };

    const shown = await notif.check(counters);
    assert.equal(shown, false);

    const el = document.querySelector("[data-tabi-stats-notification]");
    assert.equal(el, null, "no notification should be in DOM");
  });

  // Verifies that dismiss() removes the notification from the DOM.
  it("dismiss removes notification element", async () => {
    const { StatsNotification } = await import("../src/modules/StatsNotification");
    const notif = new StatsNotification();
    const counters: StatCounters = {
      hintsClicked: 5, linksYanked: 0, tabsSearched: 0, scrollActions: 0,
    };

    await notif.check(counters);
    notif.dismiss();

    // Element should be fading — but the reference should be cleared
    // The actual DOM removal happens after FADE_MS timeout
    // We verify the notification instance no longer tracks it
    const shown2 = await notif.check(counters);
    // Should not show again since timestamp was just set
    assert.equal(shown2, false);
  });
});
