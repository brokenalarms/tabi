// PremiumPrompt — animated overlay shown when non-premium users try to
// access a gated feature. Displays feature name, description, and an
// upgrade CTA. Uses inline styles so it works in any context (content
// script, settings page, popup).

import { PREMIUM_PROMPT_FADE_MS } from "./constants";

export interface PremiumFeature {
  name: string;
  icon: string;
  description: string;
}

export const PREMIUM_FEATURES: Record<string, PremiumFeature> = {
  leftHand: {
    name: "Left Hand Layout",
    icon: "\u2328",
    description: "All shortcuts on the left side of the keyboard for single-handed browsing.",
  },
  rightHand: {
    name: "Right Hand Layout",
    icon: "\u2328",
    description: "All shortcuts on the right side of the keyboard for single-handed browsing.",
  },
  statistics: {
    name: "Usage Statistics",
    icon: "\ud83d\udcca",
    description: "Track hints clicked, links yanked, time saved, and milestone achievements.",
  },
  quickmarks: {
    name: "Quick Marks",
    icon: "\ud83d\udccc",
    description: "Vim-style marks (a\u2013z) to save and jump to pages instantly.",
  },
  fuzzySearch: {
    name: "Fuzzy Tab Search",
    icon: "\ud83d\udd0d",
    description: "fzf-style fuzzy matching for faster, smarter tab switching.",
  },
  notifications: {
    name: "Weekly Stats Notification",
    icon: "\ud83d\udd14",
    description: "Get a weekly summary of your keyboard usage and milestones.",
  },
};

export class PremiumPrompt {
  private overlay: HTMLDivElement | null = null;

  /** Show the premium prompt for a specific feature. */
  show(featureKey: string, onUpgrade?: () => void): void {
    this.dismiss();

    const feature = PREMIUM_FEATURES[featureKey];
    if (!feature) return;

    // Backdrop
    const overlay = document.createElement("div");
    overlay.setAttribute("data-tabi-premium-prompt", "");
    Object.assign(overlay.style, {
      position: "fixed",
      inset: "0",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      background: "rgba(0, 0, 0, 0)",
      zIndex: "2147483647",
      transition: `background ${PREMIUM_PROMPT_FADE_MS}ms`,
    });
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) this.dismiss();
    });

    // Card
    const card = document.createElement("div");
    Object.assign(card.style, {
      background: "rgba(30, 30, 30, 0.95)",
      backdropFilter: "blur(24px)",
      WebkitBackdropFilter: "blur(24px)",
      borderRadius: "16px",
      border: "1px solid rgba(255, 255, 255, 0.1)",
      padding: "32px",
      maxWidth: "360px",
      width: "90%",
      textAlign: "center",
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif",
      color: "#e0e0e0",
      boxShadow: "0 20px 60px rgba(0, 0, 0, 0.4)",
      transform: "scale(0.95) translateY(8px)",
      opacity: "0",
      transition: `transform ${PREMIUM_PROMPT_FADE_MS}ms ease-out, opacity ${PREMIUM_PROMPT_FADE_MS}ms ease-out`,
    });

    // Icon
    const iconEl = document.createElement("div");
    Object.assign(iconEl.style, { fontSize: "36px", marginBottom: "12px" });
    iconEl.textContent = feature.icon;
    card.appendChild(iconEl);

    // Feature name
    const nameEl = document.createElement("div");
    Object.assign(nameEl.style, {
      fontSize: "18px",
      fontWeight: "700",
      marginBottom: "8px",
      color: "#fff",
    });
    nameEl.textContent = feature.name;
    card.appendChild(nameEl);

    // Description
    const descEl = document.createElement("div");
    Object.assign(descEl.style, {
      fontSize: "14px",
      lineHeight: "1.5",
      color: "#aaa",
      marginBottom: "24px",
    });
    descEl.textContent = feature.description;
    card.appendChild(descEl);

    // CTA button
    const cta = document.createElement("button");
    Object.assign(cta.style, {
      display: "block",
      width: "100%",
      padding: "12px",
      border: "none",
      borderRadius: "10px",
      background: "linear-gradient(135deg, #f59e0b, #d97706)",
      color: "#fff",
      fontSize: "15px",
      fontWeight: "700",
      fontFamily: "inherit",
      cursor: "pointer",
      marginBottom: "12px",
      transition: "opacity 0.15s",
    });
    cta.textContent = "Upgrade to Premium";
    cta.addEventListener("mouseenter", () => { cta.style.opacity = "0.9"; });
    cta.addEventListener("mouseleave", () => { cta.style.opacity = "1"; });
    cta.addEventListener("click", () => {
      if (onUpgrade) onUpgrade();
      this.dismiss();
    });
    card.appendChild(cta);

    // Dismiss link
    const dismiss = document.createElement("button");
    Object.assign(dismiss.style, {
      background: "none",
      border: "none",
      color: "#666",
      fontSize: "13px",
      cursor: "pointer",
      fontFamily: "inherit",
      padding: "4px",
    });
    dismiss.textContent = "Maybe later";
    dismiss.addEventListener("click", () => this.dismiss());
    card.appendChild(dismiss);

    overlay.appendChild(card);
    document.body.appendChild(overlay);
    this.overlay = overlay;

    // Animate in on next frame
    requestAnimationFrame(() => {
      overlay.style.background = "rgba(0, 0, 0, 0.5)";
      card.style.transform = "scale(1) translateY(0)";
      card.style.opacity = "1";
    });
  }

  /** Dismiss the prompt with a fade-out animation. */
  dismiss(): void {
    if (!this.overlay) return;
    const overlay = this.overlay;
    const card = overlay.firstElementChild as HTMLElement | null;
    this.overlay = null;

    overlay.style.background = "rgba(0, 0, 0, 0)";
    if (card) {
      card.style.transform = "scale(0.95) translateY(8px)";
      card.style.opacity = "0";
    }
    setTimeout(() => {
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    }, PREMIUM_PROMPT_FADE_MS);
  }

  /** Whether the prompt is currently visible. */
  isVisible(): boolean {
    return this.overlay !== null;
  }
}
