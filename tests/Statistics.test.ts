// Statistics unit tests — verifies counter loading, incrementing, derived
// calculations (timeSaved, distanceSaved), milestone progression, and the
// Statistics class persistence to browser.storage.local.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createDOM, type DOMEnvironment } from "./helpers/dom";
import {
  loadCounters,
  incrementCounter,
  totalActions,
  timeSaved,
  distanceSaved,
  currentMilestone,
  nextMilestone,
  SECONDS_PER_ACTION,
  FEET_PER_REACH,
  MILESTONES,
  type StatCounters,
} from "../src/modules/Statistics";

// --- Pure helper tests (no DOM or browser API needed) ---

describe("Statistics pure helpers", () => {
  // Verifies that loadCounters returns zeroed counters when storage is empty.
  it("loadCounters returns zeroes for empty storage", () => {
    const counters = loadCounters({});
    assert.deepEqual(counters, {
      hintsClicked: 0,
      linksYanked: 0,
      tabsSearched: 0,
      scrollActions: 0,
    });
  });

  // Verifies that loadCounters extracts existing counters from storage.
  it("loadCounters extracts existing counters", () => {
    const stored = {
      statistics: { hintsClicked: 5, linksYanked: 3, tabsSearched: 2, scrollActions: 10 },
    };
    const counters = loadCounters(stored);
    assert.equal(counters.hintsClicked, 5);
    assert.equal(counters.linksYanked, 3);
    assert.equal(counters.tabsSearched, 2);
    assert.equal(counters.scrollActions, 10);
  });

  // Verifies that loadCounters fills missing fields with zero.
  it("loadCounters fills missing fields with zero", () => {
    const stored = { statistics: { hintsClicked: 7 } };
    const counters = loadCounters(stored);
    assert.equal(counters.hintsClicked, 7);
    assert.equal(counters.linksYanked, 0);
    assert.equal(counters.tabsSearched, 0);
    assert.equal(counters.scrollActions, 0);
  });

  // Verifies that incrementCounter creates a new object without mutating the original.
  it("incrementCounter is immutable", () => {
    const original: StatCounters = { hintsClicked: 1, linksYanked: 0, tabsSearched: 0, scrollActions: 0 };
    const updated = incrementCounter(original, "hintsClicked");

    assert.equal(original.hintsClicked, 1);
    assert.equal(updated.hintsClicked, 2);
  });

  // Verifies that incrementCounter targets the correct counter field.
  it("incrementCounter targets the specified action", () => {
    const base: StatCounters = { hintsClicked: 0, linksYanked: 0, tabsSearched: 0, scrollActions: 0 };

    assert.equal(incrementCounter(base, "linksYanked").linksYanked, 1);
    assert.equal(incrementCounter(base, "tabsSearched").tabsSearched, 1);
    assert.equal(incrementCounter(base, "scrollActions").scrollActions, 1);
  });

  // Verifies that totalActions sums all counter fields.
  it("totalActions sums all counters", () => {
    const counters: StatCounters = { hintsClicked: 3, linksYanked: 2, tabsSearched: 1, scrollActions: 4 };
    assert.equal(totalActions(counters), 10);
  });

  // Verifies that timeSaved multiplies total actions by seconds-per-action constant.
  it("timeSaved derives from total actions", () => {
    const counters: StatCounters = { hintsClicked: 10, linksYanked: 0, tabsSearched: 0, scrollActions: 0 };
    assert.equal(timeSaved(counters), 10 * SECONDS_PER_ACTION);
  });

  // Verifies that distanceSaved multiplies total actions by feet-per-reach constant.
  it("distanceSaved derives from total actions", () => {
    const counters: StatCounters = { hintsClicked: 0, linksYanked: 0, tabsSearched: 5, scrollActions: 5 };
    assert.equal(distanceSaved(counters), 10 * FEET_PER_REACH);
  });

  // Verifies milestone progression: no milestone at zero, correct milestone at thresholds.
  it("currentMilestone returns null at zero and correct milestone at thresholds", () => {
    const zero: StatCounters = { hintsClicked: 0, linksYanked: 0, tabsSearched: 0, scrollActions: 0 };
    assert.equal(currentMilestone(zero), null);

    // Exactly at first threshold
    const atFirst: StatCounters = { hintsClicked: 10, linksYanked: 0, tabsSearched: 0, scrollActions: 0 };
    assert.equal(currentMilestone(atFirst), MILESTONES[0]);

    // Between first and second
    const between: StatCounters = { hintsClicked: 30, linksYanked: 0, tabsSearched: 0, scrollActions: 0 };
    assert.equal(currentMilestone(between), MILESTONES[0]);

    // At second threshold
    const atSecond: StatCounters = { hintsClicked: 50, linksYanked: 0, tabsSearched: 0, scrollActions: 0 };
    assert.equal(currentMilestone(atSecond), MILESTONES[1]);
  });

  // Verifies nextMilestone returns the upcoming milestone or null when all are reached.
  it("nextMilestone returns the next threshold or null when all reached", () => {
    const zero: StatCounters = { hintsClicked: 0, linksYanked: 0, tabsSearched: 0, scrollActions: 0 };
    assert.equal(nextMilestone(zero), MILESTONES[0]);

    const pastAll: StatCounters = { hintsClicked: 100000, linksYanked: 0, tabsSearched: 0, scrollActions: 0 };
    assert.equal(nextMilestone(pastAll), null);
  });
});

// --- Statistics class integration tests ---

describe("Statistics class", () => {
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

  // Verifies that load() reads counters from storage.
  it("load reads counters from storage", async () => {
    storedData.statistics = { hintsClicked: 42, linksYanked: 0, tabsSearched: 0, scrollActions: 0 };

    const { Statistics } = await import("../src/modules/Statistics");
    const stats = new Statistics();
    await stats.load();

    assert.equal(stats.getCounters().hintsClicked, 42);
  });

  // Verifies that record() increments the correct counter and persists.
  it("record increments counter and persists to storage", async () => {
    const { Statistics } = await import("../src/modules/Statistics");
    const stats = new Statistics();
    await stats.load();

    await stats.record("hintsClicked");
    await stats.record("hintsClicked");
    await stats.record("scrollActions");

    assert.equal(stats.getCounters().hintsClicked, 2);
    assert.equal(stats.getCounters().scrollActions, 1);

    // Verify storage was updated
    const persisted = storedData.statistics as StatCounters;
    assert.equal(persisted.hintsClicked, 2);
    assert.equal(persisted.scrollActions, 1);
  });

  // Verifies that record() auto-loads if load() wasn't called.
  it("record auto-loads on first call if not loaded", async () => {
    storedData.statistics = { hintsClicked: 5, linksYanked: 0, tabsSearched: 0, scrollActions: 0 };

    const { Statistics } = await import("../src/modules/Statistics");
    const stats = new Statistics();
    // No explicit load()
    await stats.record("hintsClicked");

    assert.equal(stats.getCounters().hintsClicked, 6);
  });

  // Verifies that crossing a milestone threshold triggers the milestone callback.
  it("fires milestone callback when threshold is crossed", async () => {
    storedData.statistics = { hintsClicked: 9, linksYanked: 0, tabsSearched: 0, scrollActions: 0 };

    const { Statistics } = await import("../src/modules/Statistics");
    const stats = new Statistics();
    await stats.load();

    let firedMilestone: unknown = null;
    stats.setMilestoneCallback((m) => { firedMilestone = m; });

    // Action 10 crosses the first milestone (threshold: 10)
    const crossed = await stats.record("hintsClicked");

    assert.equal(crossed, MILESTONES[0]);
    assert.equal(firedMilestone, MILESTONES[0]);
  });

  // Verifies that recording without crossing a threshold returns null and doesn't fire callback.
  it("returns null and does not fire callback when no milestone crossed", async () => {
    storedData.statistics = { hintsClicked: 5, linksYanked: 0, tabsSearched: 0, scrollActions: 0 };

    const { Statistics } = await import("../src/modules/Statistics");
    const stats = new Statistics();
    await stats.load();

    let fired = false;
    stats.setMilestoneCallback(() => { fired = true; });

    const result = await stats.record("hintsClicked");

    assert.equal(result, null);
    assert.equal(fired, false);
  });

  // Verifies getCounters returns a copy, not a reference.
  it("getCounters returns a defensive copy", async () => {
    const { Statistics } = await import("../src/modules/Statistics");
    const stats = new Statistics();
    await stats.load();

    const copy = stats.getCounters();
    copy.hintsClicked = 999;

    assert.equal(stats.getCounters().hintsClicked, 0);
  });
});
