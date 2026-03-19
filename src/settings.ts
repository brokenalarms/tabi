// Settings page — full settings UI with sidebar navigation and 5 pages.
// Uses composable builder functions for DOM construction. Reads/writes
// browser.storage.local for all settings, statistics, and quick marks.

import { PRESETS, isLayoutPremium } from "./keybindings";
import type { PresetMeta, KeyBinding } from "./keybindings";
import {
  loadCounters,
  totalActions,
  timeSaved,
  distanceSaved,
  currentMilestone,
  nextMilestone,
  MILESTONES,
} from "./modules/Statistics";
import type { StatCounters } from "./modules/Statistics";
import { loadMarks } from "./modules/QuickMarks";
import type { MarkMap } from "./modules/QuickMarks";
import { COMMANDS } from "./commands";
import { DEFAULTS } from "./types";
import type { KeyLayout, Theme, KeyBindingMode } from "./types";

declare const browser: {
  storage: {
    local: {
      get(keys: string[]): Promise<Record<string, unknown>>;
      set(items: Record<string, unknown>): Promise<void>;
    };
    onChanged: {
      addListener(
        cb: (
          changes: Record<string, { oldValue?: unknown; newValue?: unknown }>,
          areaName: string
        ) => void
      ): void;
    };
  };
};

// ── DOM helpers ───────────────────────────────────────────────

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs?: Record<string, string>,
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "class") node.className = v;
      else if (k === "text") node.textContent = v;
      else node.setAttribute(k, v);
    }
  }
  for (const child of children) {
    node.append(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return node;
}

function text(tag: keyof HTMLElementTagNameMap, className: string, content: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = content;
  return node;
}

// ── Navigation ────────────────────────────────────────────────

type PageId = "settings" | "statistics" | "quickmarks" | "keylayouts" | "premium";

interface NavEntry {
  id: PageId;
  label: string;
  icon: string;
}

const NAV_ITEMS: NavEntry[] = [
  { id: "settings", label: "Settings", icon: "\u2699" },
  { id: "statistics", label: "Statistics", icon: "\ud83d\udcca" },
  { id: "quickmarks", label: "Quick Marks", icon: "\ud83d\udccc" },
  { id: "keylayouts", label: "Key Layouts", icon: "\u2328" },
  { id: "premium", label: "Premium", icon: "\u2726" },
];

// ── State ─────────────────────────────────────────────────────

let currentPage: PageId = "settings";
let isPremium = false;
let currentLayout: KeyLayout = DEFAULTS.keyLayout;
let currentBindingMode: KeyBindingMode = DEFAULTS.keyBindingMode;
let currentTheme: Theme = DEFAULTS.theme;
let animate = DEFAULTS.animate;
let autoNotifications = DEFAULTS.autoNotifications;
let counters: StatCounters = { hintsClicked: 0, linksYanked: 0, tabsSearched: 0, scrollActions: 0 };
let marks: MarkMap = {};

// ── Page builders ─────────────────────────────────────────────

function buildSegmented(
  options: { value: string; label: string; premium?: boolean }[],
  activeValue: string,
  onChange: (value: string) => void
): HTMLElement {
  const container = el("div", { class: "segmented" });
  for (const opt of options) {
    const btn = el("button", { "data-value": opt.value, text: opt.label });
    if (opt.value === activeValue) btn.classList.add("active");
    if (opt.premium && !isPremium) {
      btn.disabled = true;
      btn.title = "Premium feature";
    }
    container.appendChild(btn);
  }
  container.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest("button") as HTMLButtonElement | null;
    if (!btn || !btn.dataset.value || btn.disabled) return;
    for (const b of container.querySelectorAll<HTMLButtonElement>("button")) {
      b.classList.toggle("active", b === btn);
    }
    onChange(btn.dataset.value);
  });
  return container;
}

function buildToggle(
  label: string,
  desc: string,
  checked: boolean,
  onChange: (v: boolean) => void
): HTMLElement {
  const row = el("div", { class: "toggle-row" });
  const info = el("div");
  info.appendChild(text("div", "toggle-label", label));
  info.appendChild(text("div", "toggle-desc", desc));
  row.appendChild(info);

  const toggle = el("label", { class: "toggle" });
  const input = el("input", { type: "checkbox" });
  if (checked) input.checked = true;
  const track = el("span", { class: "toggle-track" });
  toggle.appendChild(input);
  toggle.appendChild(track);
  row.appendChild(toggle);

  input.addEventListener("change", () => onChange(input.checked));
  return row;
}

function buildSection(label: string, hint: string, control: HTMLElement): HTMLElement {
  const section = el("div", { class: "section" });
  section.appendChild(text("label", "section-label", label));
  section.appendChild(control);
  if (hint) section.appendChild(text("p", "section-hint", hint));
  return section;
}

// ── Settings page ─────────────────────────────────────────────

function buildSettingsPage(): HTMLElement {
  const page = el("div", { class: "page", id: "page-settings" });
  page.appendChild(text("h2", "page-title", "Settings"));

  // Key Layout
  page.appendChild(
    buildSection(
      "Key Layout",
      "Home Row is great for everyone. Vim for muscle memory. One-handed layouts are premium.",
      buildSegmented(
        [
          { value: "optimized", label: "Home Row" },
          { value: "vim", label: "Vim" },
          { value: "leftHand", label: "Left Hand", premium: true },
          { value: "rightHand", label: "Right Hand", premium: true },
        ],
        currentLayout,
        (v) => {
          currentLayout = v as KeyLayout;
          browser.storage.local.set({ keyLayout: v });
        }
      )
    )
  );

  page.appendChild(el("hr", { class: "separator" }));

  // Key Binding Mode
  const bindingHint =
    "Character matches what you type. Position matches physical key location.";

  page.appendChild(
    buildSection(
      "Key Binding Mode",
      bindingHint,
      buildSegmented(
        [
          { value: "character", label: "Character" },
          { value: "location", label: "Position" },
        ],
        currentBindingMode,
        (v) => {
          currentBindingMode = v as KeyBindingMode;
          browser.storage.local.set({ keyBindingMode: v });
        }
      )
    )
  );

  page.appendChild(el("hr", { class: "separator" }));

  // Theme
  page.appendChild(
    buildSection(
      "Tag Style",
      "Auto contrasts with the page background. Classic is yellow!",
      buildSegmented(
        [
          { value: "auto", label: "Auto" },
          { value: "dark", label: "Dark" },
          { value: "light", label: "Light" },
          { value: "classic", label: "Classic" },
        ],
        currentTheme,
        (v) => {
          currentTheme = v as Theme;
          browser.storage.local.set({ theme: v });
        }
      )
    )
  );

  page.appendChild(el("hr", { class: "separator" }));

  // Animations
  page.appendChild(
    buildToggle("Animations", "Smooth transitions when hints appear and disappear", animate, (v) => {
      animate = v;
      browser.storage.local.set({ animate: v });
    })
  );

  page.appendChild(el("hr", { class: "separator" }));

  // Auto Notifications (premium)
  const notifToggle = buildToggle(
    "Weekly Stats Notification",
    "Show a summary of your keyboard usage once a week",
    autoNotifications,
    (v) => {
      autoNotifications = v;
      browser.storage.local.set({ autoNotifications: v });
    }
  );
  if (!isPremium) {
    const input = notifToggle.querySelector("input");
    if (input) {
      (input as HTMLInputElement).disabled = true;
      (input as HTMLInputElement).checked = false;
    }
  }
  page.appendChild(notifToggle);

  return page;
}

// ── Statistics page ───────────────────────────────────────────

function formatTime(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  return `${(seconds / 3600).toFixed(1)}h`;
}

function buildStatisticsPage(): HTMLElement {
  const page = el("div", { class: "page", id: "page-statistics" });

  const titleRow = el("h2", { class: "page-title" });
  titleRow.textContent = "Statistics";
  const badge = el("span", { class: "premium-badge", text: "Premium" });
  titleRow.appendChild(badge);
  page.appendChild(titleRow);

  if (!isPremium) {
    const empty = el("div", { class: "empty-state" });
    empty.appendChild(text("div", "empty-state-icon", "\ud83d\udcca"));
    empty.appendChild(
      text("div", "empty-state-text", "Statistics tracking is a premium feature. Upgrade to see your usage insights.")
    );
    page.appendChild(empty);
    return page;
  }

  // Hero stat — total actions
  const total = totalActions(counters);
  const hero = el("div", { class: "hero-stat" });
  hero.appendChild(text("div", "hero-number", total.toLocaleString()));
  hero.appendChild(text("div", "hero-label", "total keyboard actions"));
  page.appendChild(hero);

  // 4 stat cards
  const cards = el("div", { class: "stat-cards" });
  const cardData = [
    { value: counters.hintsClicked, label: "Hints clicked" },
    { value: counters.linksYanked, label: "Links yanked" },
    { value: counters.tabsSearched, label: "Tabs searched" },
    { value: counters.scrollActions, label: "Scroll actions" },
  ];
  for (const { value, label } of cardData) {
    const card = el("div", { class: "stat-card" });
    card.appendChild(text("div", "stat-card-value", value.toLocaleString()));
    card.appendChild(text("div", "stat-card-label", label));
    cards.appendChild(card);
  }
  page.appendChild(cards);

  // Derived metrics
  const derived = el("div", { class: "stat-cards" });
  const time = timeSaved(counters);
  const dist = distanceSaved(counters);
  const derivedCard1 = el("div", { class: "stat-card" });
  derivedCard1.appendChild(text("div", "stat-card-value", formatTime(time)));
  derivedCard1.appendChild(text("div", "stat-card-label", "Time saved"));
  derived.appendChild(derivedCard1);

  const derivedCard2 = el("div", { class: "stat-card" });
  derivedCard2.appendChild(text("div", "stat-card-value", `${Math.round(dist)} ft`));
  derivedCard2.appendChild(text("div", "stat-card-label", "Arm travel saved"));
  derived.appendChild(derivedCard2);
  page.appendChild(derived);

  // Milestone progress
  const milestone = currentMilestone(counters);
  const next = nextMilestone(counters);
  if (next) {
    const msSection = el("div", { class: "milestone-section" });
    msSection.appendChild(text("label", "section-label", "Next Milestone"));

    const barContainer = el("div", { class: "milestone-bar-container" });
    const bar = el("div", { class: "milestone-bar" });
    const prevThreshold = milestone ? milestone.threshold : 0;
    const progress = ((total - prevThreshold) / (next.threshold - prevThreshold)) * 100;
    bar.style.width = `${Math.min(100, Math.max(1, progress))}%`;
    barContainer.appendChild(bar);
    msSection.appendChild(barContainer);

    const labelRow = el("div", { class: "milestone-label" });
    labelRow.appendChild(text("span", "", `${total} actions`));
    labelRow.appendChild(text("span", "", `${next.threshold.toLocaleString()} actions`));
    msSection.appendChild(labelRow);

    if (milestone) {
      msSection.appendChild(text("p", "milestone-description", `"${milestone.description}"`));
    }
    page.appendChild(msSection);
  } else if (milestone) {
    const msSection = el("div", { class: "milestone-section" });
    msSection.appendChild(text("label", "section-label", "Latest Milestone"));
    msSection.appendChild(text("p", "milestone-description", `"${milestone.description}"`));
    page.appendChild(msSection);
  }

  return page;
}

// ── Quick Marks page ──────────────────────────────────────────

function buildQuickMarksPage(): HTMLElement {
  const page = el("div", { class: "page", id: "page-quickmarks" });

  const titleRow = el("h2", { class: "page-title" });
  titleRow.textContent = "Quick Marks";
  const badge = el("span", { class: "premium-badge", text: "Premium" });
  titleRow.appendChild(badge);
  page.appendChild(titleRow);

  if (!isPremium) {
    const empty = el("div", { class: "empty-state" });
    empty.appendChild(text("div", "empty-state-icon", "\ud83d\udccc"));
    empty.appendChild(
      text(
        "div",
        "empty-state-text",
        "Quick Marks is a premium feature. Set marks with m+letter, jump with '+letter."
      )
    );
    page.appendChild(empty);
    return page;
  }

  page.appendChild(
    text("p", "section-hint", "Set marks with m + letter, jump with ' + letter. Marks persist across sessions.")
  );

  const entries = Object.entries(marks).sort(([a], [b]) => a.localeCompare(b));

  if (entries.length === 0) {
    const empty = el("div", { class: "empty-state" });
    empty.appendChild(text("div", "empty-state-icon", "\ud83d\udccc"));
    empty.appendChild(text("div", "empty-state-text", "No marks set yet. Press m + a-z on any page to create one."));
    page.appendChild(empty);
    return page;
  }

  const grid = el("div", { class: "marks-grid" });
  for (const [letter, mark] of entries) {
    if (!mark) continue;
    const card = el("div", { class: "mark-card" });
    card.appendChild(text("span", "mark-letter", letter));

    const info = el("div", { class: "mark-info" });
    info.appendChild(text("div", "mark-title", mark.title || "Untitled"));
    info.appendChild(text("div", "mark-url", mark.url));
    card.appendChild(info);

    const deleteBtn = el("button", { class: "mark-delete", title: "Delete mark", text: "\u00d7" });
    deleteBtn.addEventListener("click", async () => {
      delete marks[letter];
      await browser.storage.local.set({ quickMarks: marks });
      refreshPage();
    });
    card.appendChild(deleteBtn);

    grid.appendChild(card);
  }
  page.appendChild(grid);

  return page;
}

// ── Key Layouts page ──────────────────────────────────────────

// QWERTY keyboard rows for mini visualization
const KB_ROWS = [
  ["q", "w", "e", "r", "t", "y", "u", "i", "o", "p"],
  ["a", "s", "d", "f", "g", "h", "j", "k", "l"],
  ["z", "x", "c", "v", "b", "n", "m"],
];

function getUsedKeys(preset: PresetMeta): Set<string> {
  const keys = new Set<string>();
  for (const binding of preset.bindings) {
    // Extract the last key from the sequence (the primary key)
    const parts = binding.sequence.split(" ");
    const last = parts[parts.length - 1];
    // Strip modifiers
    const code = last.replace(/^Shift-/, "");
    // Convert event.code to char
    if (code.startsWith("Key")) {
      keys.add(code.slice(3).toLowerCase());
    }
  }
  return keys;
}

function buildMiniKeyboard(preset: PresetMeta): HTMLElement {
  const used = getUsedKeys(preset);
  const kb = el("div", { class: "mini-keyboard" });
  for (const row of KB_ROWS) {
    const rowEl = el("div", { class: "mini-kb-row" });
    for (const key of row) {
      const cls = used.has(key) ? "mini-key highlight" : "mini-key";
      rowEl.appendChild(el("div", { class: cls, text: key }));
    }
    kb.appendChild(rowEl);
  }
  return kb;
}

function buildBindingTable(layout: KeyLayout): HTMLElement {
  const preset = PRESETS[layout];
  const table = el("table", { class: "binding-table" });

  const thead = el("thead");
  const headerRow = el("tr");
  headerRow.appendChild(el("th", { text: "Key" }));
  headerRow.appendChild(el("th", { text: "Action" }));
  thead.appendChild(headerRow);
  table.appendChild(thead);

  const tbody = el("tbody");
  for (const binding of preset.bindings) {
    const row = el("tr");
    const keyCell = el("td");
    keyCell.appendChild(el("span", { class: "binding-key", text: binding.display }));
    row.appendChild(keyCell);

    const desc = COMMANDS[binding.command] || binding.command;
    row.appendChild(el("td", { text: desc }));
    tbody.appendChild(row);
  }
  table.appendChild(tbody);
  return table;
}

function buildKeyLayoutsPage(): HTMLElement {
  const page = el("div", { class: "page", id: "page-keylayouts" });
  page.appendChild(text("h2", "page-title", "Key Layouts"));

  // Layout selector cards
  const cards = el("div", { class: "layout-cards" });
  const layoutKeys = Object.keys(PRESETS) as KeyLayout[];

  for (const layoutKey of layoutKeys) {
    const preset = PRESETS[layoutKey];
    const card = el("div", { class: "layout-card" });
    if (layoutKey === currentLayout) card.classList.add("active");
    if (isLayoutPremium(layoutKey) && !isPremium) card.classList.add("disabled");

    const header = el("div", { class: "layout-card-header" });
    header.appendChild(text("span", "layout-card-name", preset.label));
    if (isLayoutPremium(layoutKey)) {
      header.appendChild(el("span", { class: "premium-badge", text: "Premium" }));
    }
    card.appendChild(header);
    card.appendChild(text("p", "layout-card-desc", preset.description));
    card.appendChild(buildMiniKeyboard(preset));

    card.addEventListener("click", () => {
      if (isLayoutPremium(layoutKey) && !isPremium) return;
      currentLayout = layoutKey;
      browser.storage.local.set({ keyLayout: layoutKey });
      refreshPage();
    });

    cards.appendChild(card);
  }
  page.appendChild(cards);

  page.appendChild(el("hr", { class: "separator" }));

  // Binding mode toggle
  page.appendChild(
    buildSection(
      "Key Binding Mode",
      detectedFamily !== "qwerty"
        ? `${layoutFamilyLabel(detectedFamily)} keyboard detected. Character mode recommended.`
        : "Character matches what you type. Position matches physical key location.",
      buildSegmented(
        [
          { value: "character", label: "Character" },
          { value: "location", label: "Position" },
        ],
        currentBindingMode,
        (v) => {
          currentBindingMode = v as KeyBindingMode;
          browser.storage.local.set({ keyBindingMode: v });
        }
      )
    )
  );

  page.appendChild(el("hr", { class: "separator" }));

  // Full binding reference
  page.appendChild(text("label", "section-label", `${PRESETS[currentLayout].label} Bindings`));
  page.appendChild(buildBindingTable(currentLayout));

  return page;
}

// ── Premium page ──────────────────────────────────────────────

function buildPremiumPage(): HTMLElement {
  const page = el("div", { class: "page", id: "page-premium" });
  page.appendChild(text("h2", "page-title", "Premium"));

  const hero = el("div", { class: "premium-hero" });
  hero.appendChild(text("div", "premium-icon", isPremium ? "\u2726" : "\u2728"));
  hero.appendChild(
    text("div", "premium-status", isPremium ? "You're on Premium" : "Upgrade to Premium")
  );
  hero.appendChild(
    text(
      "div",
      "premium-subtitle",
      isPremium
        ? "Thanks for supporting tabi! All features unlocked."
        : "Unlock all layouts, statistics, and quick marks."
    )
  );
  page.appendChild(hero);

  // Feature list
  const features = [
    {
      icon: "\u2328",
      name: "One-handed Layouts",
      desc: "Left Hand and Right Hand keyboard layouts for single-handed browsing.",
    },
    {
      icon: "\ud83d\udcca",
      name: "Usage Statistics",
      desc: "Track hints clicked, links yanked, time saved, and milestone achievements.",
    },
    {
      icon: "\ud83d\udccc",
      name: "Quick Marks",
      desc: "Vim-style marks (a-z) to save and jump to pages instantly.",
    },
  ];

  const list = el("ul", { class: "feature-list" });
  for (const feat of features) {
    const item = el("li", { class: "feature-item" });
    item.appendChild(text("span", "feature-icon", feat.icon));
    const info = el("div");
    info.appendChild(text("div", "feature-name", feat.name));
    info.appendChild(text("div", "feature-desc", feat.desc));
    item.appendChild(info);
    list.appendChild(item);
  }
  page.appendChild(list);

  // CTA button
  const btn = el("button", { class: isPremium ? "upgrade-btn active-plan" : "upgrade-btn" });
  btn.textContent = isPremium ? "Active Plan" : "Upgrade to Premium";
  if (isPremium) btn.disabled = true;
  page.appendChild(btn);

  return page;
}

// ── Sidebar ───────────────────────────────────────────────────

function buildSidebar(): HTMLElement {
  const sidebar = el("div", { class: "sidebar" });

  const header = el("div", { class: "sidebar-header" });
  header.appendChild(el("h1", { text: "tabi" }));
  const pill = el("span", { class: isPremium ? "premium-pill premium" : "premium-pill" });
  pill.textContent = isPremium ? "\u2726 Premium" : "Free";
  header.appendChild(pill);
  sidebar.appendChild(header);

  for (const item of NAV_ITEMS) {
    const btn = el("button", { class: item.id === currentPage ? "nav-item active" : "nav-item" });
    btn.appendChild(el("span", { class: "nav-icon", text: item.icon }));
    btn.appendChild(document.createTextNode(item.label));
    btn.addEventListener("click", () => navigate(item.id));
    sidebar.appendChild(btn);
  }

  return sidebar;
}

// ── Render ────────────────────────────────────────────────────

const PAGE_BUILDERS: Record<PageId, () => HTMLElement> = {
  settings: buildSettingsPage,
  statistics: buildStatisticsPage,
  quickmarks: buildQuickMarksPage,
  keylayouts: buildKeyLayoutsPage,
  premium: buildPremiumPage,
};

function render(): void {
  const app = document.getElementById("app");
  if (!app) return;
  app.innerHTML = "";

  const layout = el("div", { class: "settings-layout" });
  layout.appendChild(buildSidebar());

  const main = el("div", { class: "main" });
  for (const [id, builder] of Object.entries(PAGE_BUILDERS)) {
    const page = builder();
    if (id === currentPage) page.classList.add("active");
    main.appendChild(page);
  }
  layout.appendChild(main);

  app.appendChild(layout);
}

function navigate(pageId: PageId): void {
  currentPage = pageId;
  render();
}

function refreshPage(): void {
  render();
}

// ── Init ──────────────────────────────────────────────────────

async function init(): Promise<void> {
  const stored = await browser.storage.local.get([
    "keyLayout",
    "keyBindingMode",
    "theme",
    "animate",
    "isPremium",
    "autoNotifications",
    "statistics",
    "quickMarks",
  ]);

  isPremium = stored.isPremium === true;
  currentLayout = (stored.keyLayout as KeyLayout) || DEFAULTS.keyLayout;
  currentBindingMode = (stored.keyBindingMode as KeyBindingMode) || DEFAULTS.keyBindingMode;
  currentTheme = (stored.theme as Theme) || DEFAULTS.theme;
  animate = stored.animate !== undefined ? (stored.animate as boolean) : DEFAULTS.animate;
  autoNotifications = stored.autoNotifications !== undefined ? (stored.autoNotifications as boolean) : DEFAULTS.autoNotifications;
  counters = loadCounters(stored);
  marks = loadMarks(stored);

  render();

  // Listen for external storage changes (e.g. from popup or content script)
  browser.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") return;
    let needsRefresh = false;

    if (changes.isPremium?.newValue !== undefined) {
      isPremium = changes.isPremium.newValue === true;
      needsRefresh = true;
    }
    if (changes.statistics?.newValue !== undefined) {
      counters = loadCounters({ statistics: changes.statistics.newValue });
      needsRefresh = true;
    }
    if (changes.quickMarks?.newValue !== undefined) {
      marks = loadMarks({ quickMarks: changes.quickMarks.newValue });
      needsRefresh = true;
    }
    if (changes.keyLayout?.newValue !== undefined) {
      currentLayout = changes.keyLayout.newValue as KeyLayout;
      needsRefresh = true;
    }
    if (changes.keyBindingMode?.newValue !== undefined) {
      currentBindingMode = changes.keyBindingMode.newValue as KeyBindingMode;
      needsRefresh = true;
    }
    if (changes.theme?.newValue !== undefined) {
      currentTheme = changes.theme.newValue as Theme;
      needsRefresh = true;
    }
    if (changes.animate?.newValue !== undefined) {
      animate = changes.animate.newValue as boolean;
      needsRefresh = true;
    }
    if (changes.autoNotifications?.newValue !== undefined) {
      autoNotifications = changes.autoNotifications.newValue as boolean;
      needsRefresh = true;
    }

    if (needsRefresh) refreshPage();
  });
}

init();
