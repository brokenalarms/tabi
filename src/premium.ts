// Premium entitlement gate — controls access to premium features
// and shows upgrade prompts for free users.

import { PREMIUM_TOAST_DURATION_MS } from "./modules/constants";

let premiumActive = false;

/** Whether premium is currently unlocked. */
export function isPremiumActive(): boolean {
  return premiumActive;
}

/** Update premium status (called from storage sync). */
export function setPremiumStatus(status: boolean): void {
  premiumActive = status;
}

/**
 * Gate a premium feature. Returns true if premium is active.
 * Otherwise shows an upgrade prompt and returns false.
 */
export function guardPremium(featureName: string): boolean {
  if (premiumActive) return true;
  showPremiumPrompt(featureName);
  return false;
}

// ── Upgrade toast ──────────────────────────────────────────────────

const TOAST_CLASS = "tabi-premium-toast";

let activeToast: HTMLElement | null = null;
let dismissTimer: ReturnType<typeof setTimeout> | null = null;

function dismissToast(): void {
  if (activeToast) {
    activeToast.remove();
    activeToast = null;
  }
  if (dismissTimer !== null) {
    clearTimeout(dismissTimer);
    dismissTimer = null;
  }
}

function onEscapeKey(e: KeyboardEvent): void {
  if (e.key === "Escape") {
    e.stopPropagation();
    dismissToast();
    document.removeEventListener("keydown", onEscapeKey, true);
  }
}

export function showPremiumPrompt(featureName: string): void {
  // Replace existing toast rather than stacking
  dismissToast();

  const toast = document.createElement("div");
  toast.className = TOAST_CLASS;

  const title = document.createElement("strong");
  title.textContent = featureName + " requires Premium";

  const cta = document.createElement("span");
  cta.className = "tabi-premium-cta";
  cta.textContent = "Purchase in the Tabi app";

  toast.appendChild(title);
  toast.appendChild(cta);
  document.body.appendChild(toast);
  activeToast = toast;

  // Auto-dismiss
  dismissTimer = setTimeout(() => {
    dismissToast();
    document.removeEventListener("keydown", onEscapeKey, true);
  }, PREMIUM_TOAST_DURATION_MS);

  // Escape to dismiss
  document.addEventListener("keydown", onEscapeKey, true);
}
