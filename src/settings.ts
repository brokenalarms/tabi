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
} from "./modules/Statistics";
import { SECONDS_PER_ACTION } from "./modules/constants";
import type { StatCounters } from "./modules/Statistics";
import { loadMarks } from "./modules/QuickMarks";
import type { MarkMap } from "./modules/QuickMarks";
import { COMMANDS } from "./commands";
import { DEFAULTS, FORCE_PREMIUM } from "./types";
import type { KeyLayout, Theme, KeyBindingMode } from "./types";
import { PremiumPrompt, PREMIUM_FEATURES } from "./modules/PremiumPrompt";

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
const premiumPrompt = new PremiumPrompt();

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
    if (!btn || !btn.dataset.value) return;
    if (btn.disabled) {
      // Show premium prompt for the gated feature
      const featureKey = btn.dataset.value;
      if (PREMIUM_FEATURES[featureKey]) {
        premiumPrompt.show(featureKey, () => navigate("premium"));
      }
      return;
    }
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
    notifToggle.style.cursor = "pointer";
    notifToggle.addEventListener("click", () => {
      premiumPrompt.show("notifications", () => navigate("premium"));
    });
  }
  page.appendChild(notifToggle);

  return page;
}

// ── Statistics page ───────────────────────────────────────────

function formatTime(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${(seconds / 60).toFixed(1)} min`;
  return `${(seconds / 3600).toFixed(1)} hrs`;
}

interface DistanceMilestone {
  feet: number;
  emoji: string;
  label: string;
  pct: number;
}

const DISTANCE_MILESTONES: DistanceMilestone[] = [
  { feet: 6, emoji: "\ud83e\uddca", label: "1 trip to the fridge", pct: 0 },
  { feet: 100, emoji: "\ud83d\udc0b", label: "Length of a blue whale", pct: 10 },
  { feet: 300, emoji: "\ud83c\udfc8", label: "1 football field", pct: 20 },
  { feet: 1063, emoji: "\ud83d\uddfc", label: "Height of the Eiffel Tower", pct: 32 },
  { feet: 2717, emoji: "\ud83c\udfd9", label: "Height of Burj Khalifa", pct: 44 },
  { feet: 29032, emoji: "\ud83c\udfd4", label: "Summit of Mt Everest", pct: 60 },
  { feet: 35000, emoji: "\u2708\ufe0f", label: "Cruising altitude", pct: 72 },
  { feet: 137500, emoji: "\ud83c\udfc3", label: "A marathon", pct: 84 },
  { feet: 330000, emoji: "\ud83e\uddd1\u200d\ud83d\ude80", label: "Edge of space (K\u00e1rm\u00e1n line)", pct: 100 },
];

function buildMilestoneTimeline(currentFeet: number): HTMLElement {
  const section = el("div", { class: "section" });
  section.appendChild(text("label", "section-label", "Distance Milestones"));

  const graph = el("div", { class: "milestone-graph" });
  const track = el("div", { class: "milestone-track" });

  // Interpolate a visual percentage for arbitrary feet values
  function feetToPct(feet: number): number {
    if (feet <= DISTANCE_MILESTONES[0].feet) return DISTANCE_MILESTONES[0].pct;
    for (let i = 1; i < DISTANCE_MILESTONES.length; i++) {
      const prev = DISTANCE_MILESTONES[i - 1];
      const curr = DISTANCE_MILESTONES[i];
      if (feet <= curr.feet) {
        const ratio = (feet - prev.feet) / (curr.feet - prev.feet);
        return prev.pct + ratio * (curr.pct - prev.pct);
      }
    }
    return 100;
  }

  const fillPercent = feetToPct(currentFeet);
  const fill = el("div", { class: "milestone-fill" });
  fill.style.height = `${fillPercent}%`;
  track.appendChild(fill);

  for (const ms of DISTANCE_MILESTONES) {
    const pct = ms.pct;
    const reached = currentFeet >= ms.feet;

    const marker = el("div", { class: `milestone-marker${reached ? " reached" : ""}` });
    marker.style.bottom = `${pct}%`;

    const dot = el("div", { class: "milestone-dot" });
    if (reached) dot.textContent = "\u2713";
    marker.appendChild(dot);

    const info = el("div", { class: "milestone-info" });
    info.appendChild(el("span", { class: "milestone-emoji", text: ms.emoji }));
    info.appendChild(el("span", { class: "milestone-value", text: ms.feet.toLocaleString() + " ft" }));
    info.appendChild(el("span", { class: "milestone-fact", text: "\u2014 " + ms.label }));
    marker.appendChild(info);

    track.appendChild(marker);
  }

  // "You are here" marker if between milestones
  if (currentFeet > 0) {
    const youPct = feetToPct(currentFeet);
    const youMarker = el("div", { class: "milestone-marker current" });
    youMarker.style.bottom = `${youPct}%`;

    const youDot = el("div", { class: "milestone-dot", text: "\u2605" });
    youMarker.appendChild(youDot);

    const youInfo = el("div", { class: "milestone-info" });
    youInfo.appendChild(el("span", { class: "milestone-emoji", text: "\ud83d\udccd" }));
    youInfo.appendChild(el("span", { class: "milestone-value", text: currentFeet.toLocaleString() + " ft" }));
    youInfo.appendChild(el("span", { class: "milestone-fact", text: "\u2014 You are here!" }));
    youMarker.appendChild(youInfo);

    track.appendChild(youMarker);
  }

  graph.appendChild(track);
  section.appendChild(graph);
  return section;
}

function buildStatisticsPage(): HTMLElement {
  const page = el("div", { class: "page", id: "page-statistics" });

  const titleRow = el("h2", { class: "page-title" });
  titleRow.textContent = "Statistics";
  const badge = el("span", { class: "premium-badge", text: "Premium" });
  titleRow.appendChild(badge);
  page.appendChild(titleRow);

  if (!isPremium) {
    const empty = el("div", { class: "empty-state empty-state-gated" });
    empty.appendChild(text("div", "empty-state-icon", "\ud83d\udcca"));
    empty.appendChild(
      text("div", "empty-state-text", "Statistics tracking is a premium feature. Upgrade to see your usage insights.")
    );
    const emptyBtn = el("button", { class: "upgrade-btn empty-state-cta", text: "Upgrade to Premium" });
    emptyBtn.addEventListener("click", () => navigate("premium"));
    empty.appendChild(emptyBtn);
    page.appendChild(empty);
    return page;
  }

  // Hero stat — time saved
  const time = timeSaved(counters);
  const hero = el("div", { class: "stats-hero" });
  hero.appendChild(text("div", "stats-hero-number", formatTime(time)));
  hero.appendChild(text("div", "stats-hero-label", "saved by keeping your hands on the keyboard"));
  hero.appendChild(
    text("div", "stats-hero-sub", `Based on ${SECONDS_PER_ACTION}s saved per hint click and tab search`)
  );
  page.appendChild(hero);

  // 4 stat cards with emoji icons and detail lines
  const dist = distanceSaved(counters);
  const fridgeTrips = Math.round(dist / 6);
  const cards = el("div", { class: "stat-cards" });
  const cardData: { icon: string; value: string; label: string; detail: string; cls: string }[] = [
    {
      icon: "\ud83c\udfaf",
      value: counters.hintsClicked.toLocaleString(),
      label: "Hints Clicked",
      detail: `~${Math.round((counters.hintsClicked * SECONDS_PER_ACTION) / 60)} min saved reaching for the mouse`,
      cls: "stat-card accent-border",
    },
    {
      icon: "\ud83d\udd0d",
      value: counters.tabsSearched.toLocaleString(),
      label: "Tabs Found",
      detail: `~${Math.round((counters.tabsSearched * SECONDS_PER_ACTION) / 60)} min saved cycling through tabs`,
      cls: "stat-card",
    },
    {
      icon: "\ud83d\udccb",
      value: counters.linksYanked.toLocaleString(),
      label: "Links Yanked",
      detail: "No more right-click \u2192 Copy Link",
      cls: "stat-card",
    },
    {
      icon: "\ud83d\uddb1",
      value: `${Math.round(dist).toLocaleString()} ft`,
      label: "Mouse Distance Saved",
      detail: fridgeTrips > 0
        ? `That\u2019s about ${fridgeTrips} trip${fridgeTrips !== 1 ? "s" : ""} to the fridge \ud83e\uddca`
        : "Start clicking hints to save distance!",
      cls: "stat-card emerald-border",
    },
  ];
  for (const { icon, value, label, detail, cls } of cardData) {
    const card = el("div", { class: cls });
    card.appendChild(text("div", "stat-icon", icon));
    card.appendChild(text("div", "stat-card-value", value));
    card.appendChild(text("div", "stat-card-label", label));
    card.appendChild(text("div", "stat-detail", detail));
    cards.appendChild(card);
  }
  page.appendChild(cards);

  // Vertical milestone timeline
  page.appendChild(buildMilestoneTimeline(Math.round(dist)));

  page.appendChild(el("hr", { class: "separator" }));

  // Notification preview
  const notifSection = el("div", { class: "section" });
  notifSection.appendChild(text("label", "section-label", "Weekly Notification Preview"));
  notifSection.appendChild(
    buildToggle(
      "Show weekly notification",
      "Brief stats toast appears once per 7 days",
      autoNotifications,
      (v) => {
        autoNotifications = v;
        browser.storage.local.set({ autoNotifications: v });
      }
    )
  );

  const preview = el("div", { class: "notification-preview" });
  const toast = el("div", { class: "notification-toast" });
  toast.appendChild(text("div", "notification-toast-title", "\u2726 This Week with Tabi"));

  const statsLine = el("div", { class: "notification-toast-stats" });
  const hBold = el("strong", { text: String(counters.hintsClicked) });
  const tBold = el("strong", { text: String(counters.tabsSearched) });
  const yBold = el("strong", { text: String(counters.linksYanked) });
  statsLine.append(hBold, " hints \u00a0\u00b7\u00a0 ", tBold, " tabs \u00a0\u00b7\u00a0 ", yBold, " yanks");
  toast.appendChild(statsLine);

  toast.appendChild(
    text(
      "div",
      "notification-toast-fun",
      `Your hand traveled 0 feet to the mouse. That\u2019s 0 trips to the fridge.`
    )
  );
  preview.appendChild(toast);
  preview.appendChild(text("div", "notification-label", "\u2191 Appears bottom-right, auto-dismisses after 8s"));
  notifSection.appendChild(preview);
  page.appendChild(notifSection);

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
    const empty = el("div", { class: "empty-state empty-state-gated" });
    empty.appendChild(text("div", "empty-state-icon", "\ud83d\udccc"));
    empty.appendChild(
      text(
        "div",
        "empty-state-text",
        "Quick Marks is a premium feature. Set marks with m+letter, jump with '+letter."
      )
    );
    const emptyBtn = el("button", { class: "upgrade-btn empty-state-cta", text: "Upgrade to Premium" });
    emptyBtn.addEventListener("click", () => navigate("premium"));
    empty.appendChild(emptyBtn);
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

type CommandCategory = "hints" | "scroll" | "page" | "tabs" | "actions" | "marks";

const COMMAND_CATEGORIES: Record<string, CommandCategory> = {
  activateHints: "hints",
  multiOpen: "hints",
  yankLink: "hints",
  scrollDown: "scroll",
  scrollUp: "scroll",
  scrollLeft: "scroll",
  scrollRight: "scroll",
  scrollHalfPageDown: "page",
  scrollHalfPageUp: "page",
  scrollToBottom: "page",
  scrollToTop: "page",
  createTab: "tabs",
  openTabSearch: "tabs",
  closeTab: "tabs",
  restoreTab: "tabs",
  tabLeft: "tabs",
  tabRight: "tabs",
  tabNext: "tabs",
  tabPrev: "tabs",
  goBack: "actions",
  goForward: "actions",
  pageRefresh: "actions",
  showHelp: "actions",
  focusInput: "actions",
  goUpUrl: "actions",
  setMark: "marks",
  jumpMark: "marks",
};

const CATEGORY_LABELS: { cat: CommandCategory; label: string }[] = [
  { cat: "hints", label: "Hints" },
  { cat: "scroll", label: "Scroll" },
  { cat: "page", label: "Page" },
  { cat: "tabs", label: "Tabs" },
  { cat: "actions", label: "Actions" },
  { cat: "marks", label: "Marks" },
];

// QWERTY keyboard rows for visualization
const KB_ROWS = [
  ["q", "w", "e", "r", "t", "y", "u", "i", "o", "p"],
  ["a", "s", "d", "f", "g", "h", "j", "k", "l"],
  ["z", "x", "c", "v", "b", "n", "m"],
];

function getKeyCategories(preset: PresetMeta): Map<string, CommandCategory> {
  const keys = new Map<string, CommandCategory>();

  // Single-key bindings (highest priority)
  for (const binding of preset.bindings) {
    if (binding.sequence.includes(" ")) continue;
    if (binding.sequence.startsWith("Shift-")) continue;
    const code = binding.sequence;
    if (code.startsWith("Key")) {
      const key = code.slice(3).toLowerCase();
      const cat = COMMAND_CATEGORIES[binding.command];
      if (cat) keys.set(key, cat);
    }
  }

  // Shift bindings (fill gaps)
  for (const binding of preset.bindings) {
    if (binding.sequence.includes(" ")) continue;
    if (!binding.sequence.startsWith("Shift-")) continue;
    const code = binding.sequence.replace(/^Shift-/, "");
    if (code.startsWith("Key")) {
      const key = code.slice(3).toLowerCase();
      const cat = COMMAND_CATEGORIES[binding.command];
      if (cat && !keys.has(key)) keys.set(key, cat);
    }
  }

  // Sequence keys (fill remaining gaps)
  for (const binding of preset.bindings) {
    if (!binding.sequence.includes(" ")) continue;
    for (const part of binding.sequence.split(" ")) {
      const code = part.replace(/^Shift-/, "");
      if (code.startsWith("Key")) {
        const key = code.slice(3).toLowerCase();
        const cat = COMMAND_CATEGORIES[binding.command];
        if (cat && !keys.has(key)) keys.set(key, cat);
      }
    }
  }

  return keys;
}

function buildKeyboard(
  preset: PresetMeta,
  keyClass: string,
  rowClass: string,
  containerClass: string
): HTMLElement {
  const categories = getKeyCategories(preset);
  const kb = el("div", { class: containerClass });
  for (const row of KB_ROWS) {
    const rowEl = el("div", { class: rowClass });
    for (const key of row) {
      const cat = categories.get(key);
      const cls = cat ? `${keyClass} cat-${cat}` : keyClass;
      rowEl.appendChild(el("div", { class: cls, text: key }));
    }
    kb.appendChild(rowEl);
  }
  return kb;
}

function buildMiniKeyboard(preset: PresetMeta): HTMLElement {
  return buildKeyboard(preset, "mini-key", "mini-kb-row", "mini-keyboard");
}

function buildFullKeyboard(preset: PresetMeta): HTMLElement {
  return buildKeyboard(preset, "full-key", "full-kb-row", "full-keyboard");
}

function buildLegend(): HTMLElement {
  const legend = el("div", { class: "kb-legend" });
  for (const { cat, label } of CATEGORY_LABELS) {
    const item = el("div", { class: "kb-legend-item" });
    item.appendChild(el("div", { class: `kb-legend-swatch cat-${cat}` }));
    item.appendChild(document.createTextNode(label));
    legend.appendChild(item);
  }
  return legend;
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
    const cat = COMMAND_CATEGORIES[binding.command];
    const keyCls = cat ? `binding-key cat-${cat}` : "binding-key";
    keyCell.appendChild(el("span", { class: keyCls, text: binding.display }));
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
  page.appendChild(
    text("p", "section-hint", "Choose how commands map to your keyboard. Non-vim layouts are optimized for home-row access.")
  );

  // Layout selector cards (4-column)
  const cards = el("div", { class: "layout-cards" });
  const layoutKeys = Object.keys(PRESETS) as KeyLayout[];

  for (const layoutKey of layoutKeys) {
    const preset = PRESETS[layoutKey];
    const card = el("div", { class: "layout-card" });
    if (layoutKey === currentLayout) card.classList.add("active");
    if (isLayoutPremium(layoutKey) && !isPremium) card.classList.add("disabled");

    card.appendChild(text("div", "layout-card-name", preset.label));
    card.appendChild(text("div", "layout-card-desc", preset.description));
    if (isLayoutPremium(layoutKey)) {
      const premBadge = el("span", { class: "premium-badge" });
      premBadge.textContent = "\u2726 Pro";
      premBadge.style.marginLeft = "0";
      premBadge.style.marginBottom = "4px";
      premBadge.style.display = "inline-block";
      card.appendChild(premBadge);
    }
    card.appendChild(buildMiniKeyboard(preset));

    card.addEventListener("click", () => {
      if (isLayoutPremium(layoutKey) && !isPremium) {
        premiumPrompt.show(layoutKey, () => navigate("premium"));
        return;
      }
      currentLayout = layoutKey;
      browser.storage.local.set({ keyLayout: layoutKey });
      refreshPage();
    });

    cards.appendChild(card);
  }
  page.appendChild(cards);

  // Mode indicator card
  const isPosition = currentBindingMode === "location";
  const modeCard = el("div", { class: "mode-indicator" });
  const modeInfo = el("div", { class: "mode-indicator-info" });
  const modeLabel = el("div", { class: "mode-indicator-label" });
  modeLabel.textContent = "Showing keys for: ";
  modeLabel.appendChild(el("strong", { text: isPosition ? "Position mode" : "Character mode" }));
  modeInfo.appendChild(modeLabel);
  modeInfo.appendChild(
    text(
      "div",
      "mode-indicator-desc",
      isPosition
        ? "Physical key positions (QWERTY layout). Actual labels adapt to your keyboard in Character mode."
        : "Key labels reflect your detected keyboard layout. Commands stay on the same physical keys."
    )
  );
  modeCard.appendChild(modeInfo);

  const modeToggle = buildSegmented(
    [
      { value: "character", label: "Character" },
      { value: "location", label: "Position" },
    ],
    currentBindingMode,
    (v) => {
      currentBindingMode = v as KeyBindingMode;
      browser.storage.local.set({ keyBindingMode: v });
      refreshPage();
    }
  );
  modeToggle.style.flexShrink = "0";
  modeToggle.style.marginLeft = "16px";
  modeCard.appendChild(modeToggle);
  page.appendChild(modeCard);

  // Full keyboard detail card
  page.appendChild(text("label", "section-label", `${PRESETS[currentLayout].label} Layout \u2014 Home Row`));
  page.appendChild(buildFullKeyboard(PRESETS[currentLayout]));
  page.appendChild(buildLegend());

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

  // Feature list — sourced from the shared feature catalog
  const features = [
    { icon: PREMIUM_FEATURES.leftHand.icon, name: "One-handed Layouts", desc: PREMIUM_FEATURES.leftHand.description },
    { icon: PREMIUM_FEATURES.fuzzySearch.icon, name: PREMIUM_FEATURES.fuzzySearch.name, desc: PREMIUM_FEATURES.fuzzySearch.description },
    { icon: PREMIUM_FEATURES.statistics.icon, name: PREMIUM_FEATURES.statistics.name, desc: PREMIUM_FEATURES.statistics.description },
    { icon: PREMIUM_FEATURES.quickmarks.icon, name: PREMIUM_FEATURES.quickmarks.name, desc: PREMIUM_FEATURES.quickmarks.description },
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

  isPremium = FORCE_PREMIUM || stored.isPremium === true;
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
