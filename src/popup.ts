// Popup settings UI — reads/writes browser.storage.local and updates
// the segmented button state to reflect persisted values. Shows premium
// status pill and provides a link to open the full settings page.

import { layoutFamilyFromOS, layoutFamilyLabel } from "./keyboardLayouts";
import type { LayoutFamily } from "./keyboardLayouts";

declare const browser: {
  storage: {
    local: {
      get(keys: string[]): Promise<Record<string, unknown>>;
      set(items: Record<string, unknown>): Promise<void>;
    };
  };
  runtime: {
    getURL(path: string): string;
  };
  tabs: {
    create(options: { url: string }): Promise<unknown>;
  };
};

const SETTINGS: { id: string; key: string; fallback: string }[] = [
  { id: "keyLayout", key: "keyLayout", fallback: "optimized" },
  { id: "keyBindingMode", key: "keyBindingMode", fallback: "location" },
  { id: "theme", key: "theme", fallback: "auto" },
];

function activateButton(container: HTMLElement, value: string): void {
  for (const btn of container.querySelectorAll<HTMLButtonElement>("button")) {
    btn.classList.toggle("active", btn.dataset.value === value);
  }
}

function updatePremiumPill(pill: HTMLElement, isPremium: boolean): void {
  pill.classList.toggle("premium", isPremium);
  pill.textContent = isPremium ? "\u2726 Premium" : "Free";
}

// Load persisted settings and wire click handlers.
async function init(): Promise<void> {
  const keys = [...SETTINGS.map(s => s.key), "isPremium", "keyboardLayout"];
  const stored = await browser.storage.local.get(keys);

  // Premium pill
  const pill = document.getElementById("premiumPill");
  if (pill) {
    updatePremiumPill(pill, stored.isPremium === true);
  }

  const isPremium = stored.isPremium === true;

  // Gate premium buttons
  for (const btn of document.querySelectorAll<HTMLButtonElement>("button[data-premium]")) {
    if (!isPremium) {
      btn.disabled = true;
      btn.title = "Premium feature";
    }
  }

  // Segmented controls
  for (const { id, key, fallback } of SETTINGS) {
    const container = document.getElementById(id);
    if (!container) continue;

    const current = (stored[key] as string) || fallback;
    activateButton(container, current);

    container.addEventListener("click", (e) => {
      const btn = (e.target as HTMLElement).closest("button");
      if (!btn || !btn.dataset.value || btn.disabled) return;
      activateButton(container, btn.dataset.value);
      browser.storage.local.set({ [key]: btn.dataset.value });
    });
  }

  // Detected keyboard layout — update the key binding mode hint text
  const osLayout = typeof stored.keyboardLayout === "string" ? stored.keyboardLayout : "";
  const family: LayoutFamily = layoutFamilyFromOS(osLayout);
  const bindingHint = document.querySelector("#keyBindingMode + .hint-text");
  if (bindingHint && family !== "qwerty") {
    const label = layoutFamilyLabel(family);
    bindingHint.textContent = `${label} keyboard detected. Character mode recommended.`;
  }

  // Settings link — opens full settings page in a new tab
  const settingsLink = document.getElementById("settingsLink");
  if (settingsLink) {
    settingsLink.addEventListener("click", (e) => {
      e.preventDefault();
      browser.tabs.create({ url: browser.runtime.getURL("settings.html") });
      window.close();
    });
  }
}

init();
