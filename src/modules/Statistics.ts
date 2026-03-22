// Statistics — tracks usage counters in browser.storage.local and derives
// fun "time saved" / "distance saved" metrics. Premium-only feature.
//
// Counters: hintsClicked, linksYanked, tabsSearched, scrollActions.
// Derived: timeSaved (seconds), distanceSaved (feet).
// Milestones: array of thresholds with fun-fact descriptions.

declare const browser: {
  storage: {
    local: {
      get(keys: string[]): Promise<Record<string, unknown>>;
      set(items: Record<string, unknown>): Promise<void>;
    };
  };
};

import { SECONDS_PER_ACTION, FEET_PER_REACH } from "./constants";

const STORAGE_KEY = "statistics";

export interface StatCounters {
  hintsClicked: number;
  linksYanked: number;
  tabsSearched: number;
  scrollActions: number;
}

export type StatAction = keyof StatCounters;

const EMPTY_COUNTERS: StatCounters = {
  hintsClicked: 0,
  linksYanked: 0,
  tabsSearched: 0,
  scrollActions: 0,
};


export interface Milestone {
  /** Total actions required to reach this milestone. */
  threshold: number;
  /** Fun-fact description shown to the user. */
  description: string;
}

export const MILESTONES: Milestone[] = [
  { threshold: 10, description: "Tires pumped, bags packed" },
  { threshold: 50, description: "First gravel segment cleared" },
  { threshold: 100, description: "You've found your cadence" },
  { threshold: 250, description: "Past the first summit" },
  { threshold: 500, description: "Your legs remember the way" },
  { threshold: 1000, description: "1,000 miles on the odometer" },
  { threshold: 2500, description: "Seasoned tourer — your mouse is collecting dust in a pannier" },
  { threshold: 5000, description: "Bikepacking veteran" },
  { threshold: 10000, description: "10k club — you could ride the Great Divide twice" },
];

// --- Pure helpers (testable without browser APIs) ---

export function loadCounters(stored: Record<string, unknown>): StatCounters {
  const raw = stored[STORAGE_KEY];
  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    return {
      hintsClicked: typeof obj.hintsClicked === "number" ? obj.hintsClicked : 0,
      linksYanked: typeof obj.linksYanked === "number" ? obj.linksYanked : 0,
      tabsSearched: typeof obj.tabsSearched === "number" ? obj.tabsSearched : 0,
      scrollActions: typeof obj.scrollActions === "number" ? obj.scrollActions : 0,
    };
  }
  return { ...EMPTY_COUNTERS };
}

export function incrementCounter(counters: StatCounters, action: StatAction): StatCounters {
  return { ...counters, [action]: counters[action] + 1 };
}

export function totalActions(counters: StatCounters): number {
  return counters.hintsClicked + counters.linksYanked + counters.tabsSearched + counters.scrollActions;
}

export function timeSaved(counters: StatCounters): number {
  return totalActions(counters) * SECONDS_PER_ACTION;
}

export function distanceSaved(counters: StatCounters): number {
  return totalActions(counters) * FEET_PER_REACH;
}

/** Returns the highest milestone reached, or null if none. */
export function currentMilestone(counters: StatCounters): Milestone | null {
  const total = totalActions(counters);
  let best: Milestone | null = null;
  for (const m of MILESTONES) {
    if (total >= m.threshold) best = m;
  }
  return best;
}

/** Returns the next milestone to reach, or null if all are reached. */
export function nextMilestone(counters: StatCounters): Milestone | null {
  const total = totalActions(counters);
  for (const m of MILESTONES) {
    if (total < m.threshold) return m;
  }
  return null;
}

// --- Statistics class (manages storage persistence) ---

export type MilestoneCallback = (milestone: Milestone, counters: StatCounters) => void;

export class Statistics {
  private counters: StatCounters = { ...EMPTY_COUNTERS };
  private loaded = false;
  private onMilestone: MilestoneCallback | null = null;

  /** Register a callback invoked when a new milestone is crossed. */
  setMilestoneCallback(cb: MilestoneCallback): void {
    this.onMilestone = cb;
  }

  /** Load counters from storage. Call once at startup. */
  async load(): Promise<void> {
    const stored = await browser.storage.local.get([STORAGE_KEY]);
    this.counters = loadCounters(stored);
    this.loaded = true;
  }

  /** Record an action — increments the counter and persists to storage.
   *  Returns the new milestone if one was just crossed, null otherwise. */
  async record(action: StatAction): Promise<Milestone | null> {
    if (!this.loaded) await this.load();

    const prevTotal = totalActions(this.counters);
    this.counters = incrementCounter(this.counters, action);
    const newTotal = totalActions(this.counters);

    await browser.storage.local.set({ [STORAGE_KEY]: this.counters });

    // Check if we crossed a new milestone
    const crossed = MILESTONES.find(
      m => prevTotal < m.threshold && newTotal >= m.threshold
    ) ?? null;

    if (crossed && this.onMilestone) {
      this.onMilestone(crossed, this.counters);
    }

    return crossed;
  }

  getCounters(): StatCounters {
    return { ...this.counters };
  }
}
