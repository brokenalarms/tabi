// StatsNotification — weekly auto-dismissing toast that shows usage stats.
// Checks lastStatsShown timestamp in browser.storage.local and displays
// a notification once every 7 days with hint/tab/yank counts and a fun
// distance equivalent. Premium-only, controlled by autoNotifications setting.

import type { StatCounters } from "./Statistics";
import { totalActions, distanceSaved, currentMilestone } from "./Statistics";

declare const browser: {
  storage: {
    local: {
      get(keys: string[]): Promise<Record<string, unknown>>;
      set(items: Record<string, unknown>): Promise<void>;
    };
  };
};

const STORAGE_KEY = "lastStatsShown";
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const AUTO_DISMISS_MS = 8000;
const FADE_MS = 300;

// --- Pure helpers (testable without browser APIs) ---

/** Returns true if enough time has passed since the last notification. */
export function shouldShow(lastShown: number, now: number): boolean {
  return now - lastShown >= SEVEN_DAYS_MS;
}

/** Formats a foot count into a human-friendly distance string. */
export function formatDistance(feet: number): string {
  if (feet < 100) return `${Math.round(feet)} feet`;
  if (feet < 5280) return `${Math.round(feet)} feet`;
  const miles = feet / 5280;
  if (miles < 10) return `${miles.toFixed(1)} miles`;
  return `${Math.round(miles)} miles`;
}

/** Builds the notification body text from counters. */
export function buildNotificationBody(counters: StatCounters): string {
  const total = totalActions(counters);
  if (total === 0) return "No actions recorded yet. Start browsing with keyboard shortcuts!";

  const parts: string[] = [];
  if (counters.hintsClicked > 0) parts.push(`${counters.hintsClicked} hints`);
  if (counters.linksYanked > 0) parts.push(`${counters.linksYanked} yanks`);
  if (counters.tabsSearched > 0) parts.push(`${counters.tabsSearched} tab searches`);
  if (counters.scrollActions > 0) parts.push(`${counters.scrollActions} scrolls`);

  const dist = distanceSaved(counters);
  const distStr = formatDistance(dist);
  const milestone = currentMilestone(counters);

  let body = `This week: ${parts.join(", ")}. You've saved your arm ${distStr} of travel.`;
  if (milestone) {
    body += ` "${milestone.description}"`;
  }
  return body;
}

// --- StatsNotification class ---

export class StatsNotification {
  private el: HTMLDivElement | null = null;
  private dismissTimer: ReturnType<typeof setTimeout> | null = null;
  private keyListener: ((e: KeyboardEvent) => void) | null = null;

  /** Check if a notification is due and show it if so. */
  async check(counters: StatCounters): Promise<boolean> {
    const stored = await browser.storage.local.get([STORAGE_KEY]);
    const lastShown = typeof stored[STORAGE_KEY] === "number"
      ? stored[STORAGE_KEY] as number
      : 0;

    if (!shouldShow(lastShown, Date.now())) return false;

    await browser.storage.local.set({ [STORAGE_KEY]: Date.now() });
    this.show(counters);
    return true;
  }

  private show(counters: StatCounters): void {
    this.dismiss();

    const total = totalActions(counters);
    const body = buildNotificationBody(counters);

    const container = document.createElement("div");
    container.setAttribute("data-tabi-stats-notification", "");
    Object.assign(container.style, {
      position: "fixed",
      bottom: "20px",
      right: "20px",
      maxWidth: "340px",
      padding: "16px 20px",
      borderRadius: "12px",
      border: "1px solid rgba(245, 158, 11, 0.4)",
      background: "rgba(30, 30, 30, 0.92)",
      backdropFilter: "blur(20px)",
      WebkitBackdropFilter: "blur(20px)",
      color: "#e0e0e0",
      fontSize: "13px",
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif",
      lineHeight: "1.5",
      zIndex: "2147483647",
      pointerEvents: "auto",
      transition: `opacity ${FADE_MS}ms`,
      opacity: "0",
      boxShadow: "0 4px 24px rgba(0, 0, 0, 0.3)",
    });

    // Header
    const header = document.createElement("div");
    Object.assign(header.style, {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: "8px",
    });

    const title = document.createElement("div");
    Object.assign(title.style, {
      fontWeight: "600",
      fontSize: "14px",
      color: "#f59e0b",
    });
    title.textContent = `tabi — ${total.toLocaleString()} actions`;
    header.appendChild(title);

    const closeBtn = document.createElement("button");
    Object.assign(closeBtn.style, {
      background: "none",
      border: "none",
      color: "#888",
      fontSize: "16px",
      cursor: "pointer",
      padding: "0 0 0 8px",
      lineHeight: "1",
    });
    closeBtn.textContent = "\u00d7";
    closeBtn.addEventListener("click", () => this.dismiss());
    header.appendChild(closeBtn);

    container.appendChild(header);

    // Body
    const bodyEl = document.createElement("div");
    bodyEl.textContent = body;
    container.appendChild(bodyEl);

    document.body.appendChild(container);
    this.el = container;

    // Fade in on next frame
    requestAnimationFrame(() => {
      container.style.opacity = "1";
    });

    // Auto-dismiss after 8 seconds
    this.dismissTimer = setTimeout(() => this.dismiss(), AUTO_DISMISS_MS);

    // Dismiss on any keypress
    this.keyListener = () => this.dismiss();
    document.addEventListener("keydown", this.keyListener, { once: true });
  }

  dismiss(): void {
    if (this.dismissTimer) {
      clearTimeout(this.dismissTimer);
      this.dismissTimer = null;
    }
    if (this.keyListener) {
      document.removeEventListener("keydown", this.keyListener);
      this.keyListener = null;
    }
    if (this.el) {
      const el = this.el;
      el.style.opacity = "0";
      setTimeout(() => {
        if (el.parentNode) el.parentNode.removeChild(el);
      }, FADE_MS);
      this.el = null;
    }
  }
}
