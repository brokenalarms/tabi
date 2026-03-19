// Popup settings UI — reads/writes browser.storage.local and updates
// the segmented button state to reflect persisted values.

declare const browser: {
  storage: {
    local: {
      get(keys: string[]): Promise<Record<string, unknown>>;
      set(items: Record<string, unknown>): Promise<void>;
    };
  };
};

const SETTINGS: { id: string; key: string; fallback: string }[] = [
  { id: "keyBindingMode", key: "keyBindingMode", fallback: "location" },
  { id: "theme", key: "theme", fallback: "auto" },
];

function activateButton(container: HTMLElement, value: string): void {
  for (const btn of container.querySelectorAll<HTMLButtonElement>("button")) {
    btn.classList.toggle("active", btn.dataset.value === value);
  }
}

// Load persisted settings and wire click handlers.
async function init(): Promise<void> {
  const keys = SETTINGS.map(s => s.key);
  const stored = await browser.storage.local.get(keys);

  for (const { id, key, fallback } of SETTINGS) {
    const container = document.getElementById(id);
    if (!container) continue;

    const current = (stored[key] as string) || fallback;
    activateButton(container, current);

    container.addEventListener("click", (e) => {
      const btn = (e.target as HTMLElement).closest("button");
      if (!btn || !btn.dataset.value) return;
      activateButton(container, btn.dataset.value);
      browser.storage.local.set({ [key]: btn.dataset.value });
    });
  }
}

init();
