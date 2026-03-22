// Settings page integration tests — run in real WebKit via Playwright.
// These tests verify the settings page renders correctly with sidebar
// navigation, premium gating shows the prompt overlay, and statistics
// counters display accurate values. Requires a real browser because the
// settings page relies on DOM layout and CSS for page visibility.

import { test, expect } from "@playwright/test";
import path from "path";
import fs from "fs";

const SETTINGS_JS = path.resolve(__dirname, "settings.js");
const CSS_DIR = path.resolve(__dirname, "../../Tabi/Safari Extension/Resources/styles");
const SCREENSHOT_DIR = path.resolve(__dirname, "../../scripts/screenshots");

type StorageSeed = Record<string, unknown>;

/** Set up the settings page with a mocked browser.storage API and optional seed data. */
async function setupSettingsPage(
  page: import("@playwright/test").Page,
  storageSeed: StorageSeed = {}
) {
  await page.setContent(`<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body>
  <div id="app"></div>
</body>
</html>`);

  // Inject a browser.storage mock that the settings script reads from
  await page.evaluate((seed: StorageSeed) => {
    const storage: Record<string, unknown> = { ...seed };
    const listeners: Array<(changes: Record<string, { oldValue?: unknown; newValue?: unknown }>, area: string) => void> = [];

    (window as any).browser = {
      storage: {
        local: {
          async get(_keys: string[]) {
            return { ...storage };
          },
          async set(items: Record<string, unknown>) {
            const changes: Record<string, { oldValue?: unknown; newValue?: unknown }> = {};
            for (const [k, v] of Object.entries(items)) {
              changes[k] = { oldValue: storage[k], newValue: v };
              storage[k] = v;
            }
            for (const cb of listeners) cb(changes, "local");
          },
        },
        onChanged: {
          addListener(cb: any) {
            listeners.push(cb);
          },
        },
      },
    };
  }, storageSeed);

  // Load the bundled settings script (calls init() which renders the page)
  await page.addScriptTag({ path: SETTINGS_JS });

  // Wait for the app to render (init is async — it awaits storage.get)
  await page.waitForSelector(".settings-layout");
}

// ── Settings page rendering ────────────────────────────────────────

test("settings page renders sidebar with all navigation items", async ({ page }) => {
  await setupSettingsPage(page);

  const navItems = await page.locator(".nav-item").allTextContents();
  for (const label of ["Key Layouts", "Quick Marks", "Statistics", "Premium"]) {
    expect(navItems.some(item => item.includes(label))).toBe(true);
  }
  expect(navItems).toHaveLength(4);
});

test("settings page shows Key Layouts as default active page", async ({ page }) => {
  await setupSettingsPage(page);

  const activePage = page.locator(".page.active");
  await expect(activePage).toHaveCount(1);
  await expect(activePage.locator(".page-title")).toHaveText("Key Layouts");
});

test("sidebar shows Free pill when not premium", async ({ page }) => {
  await setupSettingsPage(page);

  const pill = page.locator(".premium-pill");
  await expect(pill).toHaveText("Free");
  // Class is just "premium-pill" without the "premium" modifier
  await expect(pill).toHaveClass("premium-pill");
});

test("sidebar shows Licensed pill when premium is active", async ({ page }) => {
  await setupSettingsPage(page, { isPremium: true });

  const pill = page.locator(".premium-pill");
  await expect(pill).toContainText("Licensed");
  await expect(pill).toHaveClass(/premium/);
});

test("navigation switches active page", async ({ page }) => {
  await setupSettingsPage(page);

  await page.locator(".nav-item", { hasText: "Statistics" }).click();

  const activePage = page.locator(".page.active");
  await expect(activePage.locator(".page-title")).toContainText("Statistics");
});

// ── Tag style visual previews ──────────────────────────────────────

test("key layouts page shows mode color previews with Click, Yank, Multi tags", async ({ page }) => {
  await setupSettingsPage(page);

  const previews = page.locator(".mode-color-preview");
  await expect(previews).toHaveCount(3);

  const labels = await page.locator(".mode-color-label").allTextContents();
  expect(labels).toEqual(["Click", "Yank", "Multi"]);

  const tags = page.locator(".mode-hint-tag");
  await expect(tags).toHaveCount(3);
  await expect(tags.nth(0)).toHaveClass(/click/);
  await expect(tags.nth(1)).toHaveClass(/yank/);
  await expect(tags.nth(2)).toHaveClass(/multi/);
});

test("mode color previews reflect active theme and update on theme change", async ({ page }) => {
  // Preview tags should match the selected theme via data-tag-theme
  await setupSettingsPage(page);

  const modeColors = page.locator(".mode-colors");

  // Default theme is "auto"
  await expect(modeColors).toHaveAttribute("data-tag-theme", "auto");

  // Change theme to "dark" via the segmented control
  await page.locator(".segmented button", { hasText: "Dark" }).click();
  await expect(modeColors).toHaveAttribute("data-tag-theme", "dark");

  // Change theme to "light"
  await page.locator(".segmented button", { hasText: "Light" }).click();
  await expect(modeColors).toHaveAttribute("data-tag-theme", "light");

  // Change theme to "classic"
  await page.locator(".segmented button", { hasText: "Classic" }).click();
  await expect(modeColors).toHaveAttribute("data-tag-theme", "classic");
});

// ── Premium gate overlay ───────────────────────────────────────────

test("clicking disabled premium layout card shows premium prompt", async ({ page }) => {
  await setupSettingsPage(page);

  const leftHandCard = page.locator(".layout-card.disabled", { hasText: "Left Hand" });
  await expect(leftHandCard).toBeVisible();
  await leftHandCard.click();

  const overlay = page.locator("[data-tabi-premium-prompt]");
  await expect(overlay).toBeVisible();
  await expect(overlay).toContainText("Left Hand Layout");
  await expect(overlay).toContainText("Purchase License");
  await expect(overlay).toContainText("Maybe later");
});

test("premium prompt dismiss button removes overlay", async ({ page }) => {
  await setupSettingsPage(page);

  await page.locator(".layout-card.disabled", { hasText: "Left Hand" }).click();
  const overlay = page.locator("[data-tabi-premium-prompt]");
  await expect(overlay).toBeVisible();

  await page.locator("[data-tabi-premium-prompt] button", { hasText: "Maybe later" }).click();
  await expect(overlay).toBeHidden({ timeout: 1000 });
});

test("premium prompt CTA navigates to license page", async ({ page }) => {
  await setupSettingsPage(page);

  await page.locator(".layout-card.disabled", { hasText: "Right Hand" }).click();
  await expect(page.locator("[data-tabi-premium-prompt]")).toBeVisible();

  await page.locator("[data-tabi-premium-prompt] button", { hasText: "Purchase License" }).click();

  const activePage = page.locator(".page.active");
  await expect(activePage).toHaveAttribute("id", "page-premium");
});

test("premium user does not see disabled layout cards", async ({ page }) => {
  await setupSettingsPage(page, { isPremium: true });

  const disabledCards = page.locator(".layout-card.disabled");
  await expect(disabledCards).toHaveCount(0);
});

// ── Statistics page ────────────────────────────────────────────────

test("statistics page shows gated empty state for non-premium users", async ({ page }) => {
  await setupSettingsPage(page);

  await page.locator(".nav-item", { hasText: "Statistics" }).click();

  const activePage = page.locator(".page.active");
  await expect(activePage).toContainText("Statistics tracking requires a license");
  await expect(activePage.locator(".empty-state-cta")).toBeVisible();
});

test("statistics page displays counters for premium users", async ({ page }) => {
  await setupSettingsPage(page, {
    isPremium: true,
    statistics: {
      hintsClicked: 42,
      linksYanked: 15,
      tabsSearched: 8,
      scrollActions: 35,
    },
  });

  await page.locator(".nav-item", { hasText: "Statistics" }).click();

  const activePage = page.locator(".page.active");

  // Hero stat — time saved (100 actions * 1.3s = 130s = 2.2 min)
  await expect(activePage.locator(".stats-hero-number")).toContainText("min");

  // Individual stat cards show counts
  const cardValues = await activePage.locator(".stat-card-value").allTextContents();
  expect(cardValues).toContain("42");
  expect(cardValues).toContain("15");
  expect(cardValues).toContain("8");
});

test("statistics page shows milestone timeline for premium users", async ({ page }) => {
  await setupSettingsPage(page, {
    isPremium: true,
    statistics: {
      hintsClicked: 60,
      linksYanked: 20,
      tabsSearched: 10,
      scrollActions: 15,
    },
  });

  await page.locator(".nav-item", { hasText: "Statistics" }).click();

  const activePage = page.locator(".page.active");

  // Vertical milestone timeline should be visible
  await expect(activePage.locator(".milestone-graph")).toBeVisible();
  // "You are here" marker should exist
  await expect(activePage.locator(".milestone-marker.current")).toBeVisible();
});

test("statistics page shows distance in stat card and notification preview", async ({ page }) => {
  await setupSettingsPage(page, {
    isPremium: true,
    statistics: {
      hintsClicked: 100,
      linksYanked: 0,
      tabsSearched: 0,
      scrollActions: 0,
    },
  });

  await page.locator(".nav-item", { hasText: "Statistics" }).click();

  const activePage = page.locator(".page.active");

  // Mouse Distance Saved card shows distance
  const cardLabels = await activePage.locator(".stat-card-label").allTextContents();
  expect(cardLabels).toContain("Mouse Distance Saved");

  // Notification preview toast is visible
  await expect(activePage.locator(".notification-toast")).toBeVisible();
});

// ── Quick Marks page ───────────────────────────────────────────────

test("quick marks page shows gated state for non-premium users", async ({ page }) => {
  await setupSettingsPage(page);

  await page.locator(".nav-item", { hasText: "Quick Marks" }).click();

  const activePage = page.locator(".page.active");
  await expect(activePage).toContainText("Quick Marks requires a license");
});

test("quick marks page shows empty state for premium users with no marks", async ({ page }) => {
  await setupSettingsPage(page, { isPremium: true });

  await page.locator(".nav-item", { hasText: "Quick Marks" }).click();

  const activePage = page.locator(".page.active");
  await expect(activePage).toContainText("No marks set yet");
});

test("quick marks page shows add-mark form for premium users", async ({ page }) => {
  await setupSettingsPage(page, { isPremium: true });

  await page.locator(".nav-item", { hasText: "Quick Marks" }).click();

  const form = page.locator(".add-mark-form");
  await expect(form).toBeVisible();
  await expect(form.locator(".add-mark-letter")).toBeVisible();
  await expect(form.locator(".add-mark-url")).toBeVisible();
  await expect(form.locator(".add-mark-title")).toBeVisible();
  await expect(form.locator(".add-mark-save")).toBeDisabled();
});

test("add-mark form creates a new mark and refreshes the page", async ({ page }) => {
  await setupSettingsPage(page, { isPremium: true });

  await page.locator(".nav-item", { hasText: "Quick Marks" }).click();

  // Fill out the form
  await page.locator(".add-mark-letter").fill("a");
  await page.locator(".add-mark-url").fill("https://example.com/page");
  await page.locator(".add-mark-title").fill("Example Page");

  // Save button should be enabled
  await expect(page.locator(".add-mark-save")).toBeEnabled();
  await page.locator(".add-mark-save").click();

  // Page should refresh and show the new mark card
  const markCard = page.locator(".mark-card");
  await expect(markCard).toHaveCount(1);
  await expect(markCard.locator(".mark-letter")).toHaveText("a");
  await expect(markCard.locator(".mark-title")).toHaveText("Example Page");
});

test("add-mark form disables save for duplicate letter", async ({ page }) => {
  await setupSettingsPage(page, {
    isPremium: true,
    quickMarks: { b: { url: "https://existing.com", scrollY: 0, title: "Existing" } },
  });

  await page.locator(".nav-item", { hasText: "Quick Marks" }).click();

  await page.locator(".add-mark-letter").fill("b");
  await page.locator(".add-mark-url").fill("https://new.com");

  await expect(page.locator(".add-mark-save")).toBeDisabled();
});

test("add-mark form disables save for invalid URL", async ({ page }) => {
  await setupSettingsPage(page, { isPremium: true });

  await page.locator(".nav-item", { hasText: "Quick Marks" }).click();

  await page.locator(".add-mark-letter").fill("c");
  await page.locator(".add-mark-url").fill("not-a-url");

  await expect(page.locator(".add-mark-save")).toBeDisabled();
});

// mark card shows summarized URL, not raw URL
test("mark card displays summarized URL", async ({ page }) => {
  await setupSettingsPage(page, {
    isPremium: true,
    quickMarks: { g: { url: "https://github.com/user/repo/pulls", scrollY: 0, title: "PR List" } },
  });

  await page.locator(".nav-item", { hasText: "Quick Marks" }).click();

  const markCard = page.locator(".mark-card");
  await expect(markCard.locator(".mark-url")).toHaveText("github.com/\u2026/pulls");
});

// clicking a mark card enters inline edit mode with current values
test("clicking mark card enters edit mode", async ({ page }) => {
  await setupSettingsPage(page, {
    isPremium: true,
    quickMarks: { a: { url: "https://example.com/page", scrollY: 100, title: "My Page" } },
  });

  await page.locator(".nav-item", { hasText: "Quick Marks" }).click();

  const markCard = page.locator(".mark-card");
  await markCard.click();

  await expect(markCard).toHaveClass(/mark-card-editing/);
  await expect(markCard.locator(".mark-edit-letter")).toHaveValue("a");
  await expect(markCard.locator(".mark-edit-title")).toHaveValue("My Page");
  await expect(markCard.locator(".mark-edit-url")).toHaveValue("https://example.com/page");
});

// editing a mark and saving persists the changes
test("edit mode saves updated mark", async ({ page }) => {
  await setupSettingsPage(page, {
    isPremium: true,
    quickMarks: { a: { url: "https://example.com/page", scrollY: 100, title: "Old Title" } },
  });

  await page.locator(".nav-item", { hasText: "Quick Marks" }).click();

  await page.locator(".mark-card").click();
  await page.locator(".mark-edit-title").fill("New Title");
  await page.locator(".mark-edit-save").click();

  const markCard = page.locator(".mark-card");
  await expect(markCard.locator(".mark-title")).toHaveText("New Title");
});

// edit mode cancel returns to display mode without changes
test("edit mode cancel restores original card", async ({ page }) => {
  await setupSettingsPage(page, {
    isPremium: true,
    quickMarks: { a: { url: "https://example.com/page", scrollY: 100, title: "Original" } },
  });

  await page.locator(".nav-item", { hasText: "Quick Marks" }).click();

  await page.locator(".mark-card").click();
  await page.locator(".mark-edit-title").fill("Changed");
  await page.locator(".mark-edit-cancel").click();

  const markCard = page.locator(".mark-card");
  await expect(markCard.locator(".mark-title")).toHaveText("Original");
});

// ── Premium page ───────────────────────────────────────────────────

test("license page shows purchase CTA for unlicensed users", async ({ page }) => {
  await setupSettingsPage(page);

  await page.locator(".nav-item", { hasText: "Premium" }).click();

  const activePage = page.locator(".page.active");
  await expect(activePage.locator(".premium-status")).toHaveText("Unlicensed");
  await expect(activePage.locator(".upgrade-cta")).toBeEnabled();
});

test("license page shows licensed status without purchase button", async ({ page }) => {
  await setupSettingsPage(page, { isPremium: true });

  await page.locator(".nav-item", { hasText: "Premium" }).click();

  const activePage = page.locator(".page.active");
  await expect(activePage.locator(".premium-status")).toHaveText("Licensed");
  await expect(activePage.locator(".upgrade-cta")).toHaveCount(0);
});

// ── Storage reactivity ─────────────────────────────────────────────

test("settings page re-renders when storage changes externally", async ({ page }) => {
  await setupSettingsPage(page, {
    isPremium: false,
  });

  // Initially non-premium
  const pill = page.locator(".premium-pill");
  await expect(pill).toHaveText("Free");

  // Simulate an external storage change (e.g. purchase completes)
  await page.evaluate(() => {
    (window as any).browser.storage.local.set({ isPremium: true });
  });

  // The page should reactively re-render with licensed status
  await expect(pill).toContainText("Licensed");
});

// ── Screenshots for visual comparison ─────────────────────────────────

async function setupStyledSettingsPage(
  page: import("@playwright/test").Page,
  storageSeed: StorageSeed = {}
) {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.setViewportSize({ width: 960, height: 800 });

  await page.setContent(`<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body>
  <div id="app"></div>
</body>
</html>`);

  // Load theme + settings CSS
  for (const file of ["tabi-theme.css", "settings.css"]) {
    const css = fs.readFileSync(path.join(CSS_DIR, file), "utf-8");
    await page.addStyleTag({ content: css });
  }

  // Inject browser.storage mock
  await page.evaluate((seed: StorageSeed) => {
    const storage: Record<string, unknown> = { ...seed };
    const listeners: Array<(changes: Record<string, { oldValue?: unknown; newValue?: unknown }>, area: string) => void> = [];
    (window as any).browser = {
      storage: {
        local: {
          async get(_keys: string[]) { return { ...storage }; },
          async set(items: Record<string, unknown>) {
            const changes: Record<string, { oldValue?: unknown; newValue?: unknown }> = {};
            for (const [k, v] of Object.entries(items)) {
              changes[k] = { oldValue: storage[k], newValue: v };
              storage[k] = v;
            }
            for (const cb of listeners) cb(changes, "local");
          },
        },
        onChanged: { addListener(cb: any) { listeners.push(cb); } },
      },
    };
  }, storageSeed);

  await page.addScriptTag({ path: SETTINGS_JS });
  await page.waitForSelector(".settings-layout");
}

test("screenshot: statistics page", async ({ page }) => {
  await setupStyledSettingsPage(page, {
    isPremium: true,
    statistics: {
      hintsClicked: 2847,
      linksYanked: 456,
      tabsSearched: 1203,
      scrollActions: 3914,
    },
  });

  await page.locator(".nav-item", { hasText: "Statistics" }).click();
  await page.waitForSelector(".stats-hero");

  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  // Full page screenshot to capture milestone timeline + notification preview
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, "settings-statistics.png"), fullPage: true });
});

test("screenshot: key layouts page", async ({ page }) => {
  await setupStyledSettingsPage(page, { isPremium: true });

  await page.waitForSelector(".layout-cards");

  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, "settings-keylayouts.png") });
});
