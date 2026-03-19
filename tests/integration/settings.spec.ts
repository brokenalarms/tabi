// Settings page integration tests — run in real WebKit via Playwright.
// These tests verify the settings page renders correctly with sidebar
// navigation, premium gating shows the prompt overlay, and statistics
// counters display accurate values. Requires a real browser because the
// settings page relies on DOM layout and CSS for page visibility.

import { test, expect } from "@playwright/test";
import path from "path";

const SETTINGS_JS = path.resolve(__dirname, "settings.js");

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
  // Nav items include an icon span prefix (e.g. "⚙Settings")
  for (const label of ["Settings", "Statistics", "Quick Marks", "Key Layouts", "Premium"]) {
    expect(navItems.some(item => item.includes(label))).toBe(true);
  }
  expect(navItems).toHaveLength(5);
});

test("settings page shows Settings as default active page", async ({ page }) => {
  await setupSettingsPage(page);

  const activePage = page.locator(".page.active");
  await expect(activePage).toHaveCount(1);
  await expect(activePage.locator(".page-title")).toHaveText("Settings");
});

test("sidebar shows Free pill when not premium", async ({ page }) => {
  await setupSettingsPage(page);

  const pill = page.locator(".premium-pill");
  await expect(pill).toHaveText("Free");
  // Class is just "premium-pill" without the "premium" modifier
  await expect(pill).toHaveClass("premium-pill");
});

test("sidebar shows Premium pill when premium is active", async ({ page }) => {
  await setupSettingsPage(page, { isPremium: true });

  const pill = page.locator(".premium-pill");
  await expect(pill).toContainText("Premium");
  await expect(pill).toHaveClass(/premium/);
});

test("navigation switches active page", async ({ page }) => {
  await setupSettingsPage(page);

  // Click Key Layouts nav item
  await page.locator(".nav-item", { hasText: "Key Layouts" }).click();

  const activePage = page.locator(".page.active");
  await expect(activePage.locator(".page-title")).toHaveText("Key Layouts");
});

// ── Premium gate overlay ───────────────────────────────────────────

test("clicking disabled premium layout button shows premium prompt", async ({ page }) => {
  // Non-premium user — Left Hand should be disabled
  await setupSettingsPage(page);

  // The Left Hand button in the Key Layout segmented control
  const leftHandBtn = page.locator('.segmented button[data-value="leftHand"]');
  await expect(leftHandBtn).toBeDisabled();

  // Disabled buttons swallow click events in real browsers, so dispatch
  // the click on the segmented container with the button as the target —
  // mirroring how event delegation works when the user clicks.
  await page.evaluate(() => {
    const btn = document.querySelector('.segmented button[data-value="leftHand"]') as HTMLElement;
    const event = new MouseEvent("click", { bubbles: true });
    btn.dispatchEvent(event);
  });

  // Premium prompt overlay should appear
  const overlay = page.locator("[data-tabi-premium-prompt]");
  await expect(overlay).toBeVisible();
  await expect(overlay).toContainText("Left Hand Layout");
  await expect(overlay).toContainText("Upgrade to Premium");
  await expect(overlay).toContainText("Maybe later");
});

test("premium prompt dismiss button removes overlay", async ({ page }) => {
  await setupSettingsPage(page);

  // Trigger the premium prompt via dispatching click on the disabled button
  await page.evaluate(() => {
    const btn = document.querySelector('.segmented button[data-value="leftHand"]') as HTMLElement;
    btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  const overlay = page.locator("[data-tabi-premium-prompt]");
  await expect(overlay).toBeVisible();

  // Click "Maybe later"
  await page.locator("[data-tabi-premium-prompt] button", { hasText: "Maybe later" }).click();

  // Overlay fades out (FADE_MS = 200ms) then is removed
  await expect(overlay).toBeHidden({ timeout: 1000 });
});

test("premium prompt CTA navigates to Premium page", async ({ page }) => {
  await setupSettingsPage(page);

  // Trigger the premium prompt via dispatching click on the disabled button
  await page.evaluate(() => {
    const btn = document.querySelector('.segmented button[data-value="rightHand"]') as HTMLElement;
    btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await expect(page.locator("[data-tabi-premium-prompt]")).toBeVisible();

  // Click the CTA button (inside the overlay, not the page's upgrade button)
  await page.locator("[data-tabi-premium-prompt] button", { hasText: "Upgrade to Premium" }).click();

  // Should navigate to the Premium page
  const activePage = page.locator(".page.active");
  await expect(activePage).toHaveAttribute("id", "page-premium");
});

test("premium user does not see disabled layout buttons", async ({ page }) => {
  await setupSettingsPage(page, { isPremium: true });

  const leftHandBtn = page.locator('.segmented button[data-value="leftHand"]');
  await expect(leftHandBtn).toBeEnabled();

  const rightHandBtn = page.locator('.segmented button[data-value="rightHand"]');
  await expect(rightHandBtn).toBeEnabled();
});

// ── Statistics page ────────────────────────────────────────────────

test("statistics page shows gated empty state for non-premium users", async ({ page }) => {
  await setupSettingsPage(page);

  await page.locator(".nav-item", { hasText: "Statistics" }).click();

  const activePage = page.locator(".page.active");
  await expect(activePage).toContainText("Statistics tracking is a premium feature");
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

  // Hero stat — total actions (42 + 15 + 8 + 35 = 100)
  await expect(activePage.locator(".hero-number")).toHaveText("100");

  // Individual stat cards
  const cardValues = await activePage.locator(".stat-card-value").allTextContents();
  expect(cardValues).toContain("42");
  expect(cardValues).toContain("15");
  expect(cardValues).toContain("8");
  expect(cardValues).toContain("35");
});

test("statistics page shows milestone progress for premium users", async ({ page }) => {
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

  // Total = 105, which is past the 100 milestone, next is 250
  await expect(activePage.locator(".milestone-section")).toBeVisible();
  // Current milestone description should be visible
  await expect(activePage.locator(".milestone-description")).toContainText(
    "Your arm has been spared 100 feet of travel"
  );
});

test("statistics page shows derived metrics", async ({ page }) => {
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
  const cardLabels = await activePage.locator(".stat-card-label").allTextContents();

  // Should include the derived metric labels
  expect(cardLabels).toContain("Time saved");
  expect(cardLabels).toContain("Arm travel saved");

  // 100 actions * 1.3s = 130s = 2m (rounded)
  const cardValues = await activePage.locator(".stat-card-value").allTextContents();
  expect(cardValues).toContain("2m");
  expect(cardValues).toContain("100 ft");
});

// ── Quick Marks page ───────────────────────────────────────────────

test("quick marks page shows gated state for non-premium users", async ({ page }) => {
  await setupSettingsPage(page);

  await page.locator(".nav-item", { hasText: "Quick Marks" }).click();

  const activePage = page.locator(".page.active");
  await expect(activePage).toContainText("Quick Marks is a premium feature");
});

test("quick marks page shows empty state for premium users with no marks", async ({ page }) => {
  await setupSettingsPage(page, { isPremium: true });

  await page.locator(".nav-item", { hasText: "Quick Marks" }).click();

  const activePage = page.locator(".page.active");
  await expect(activePage).toContainText("No marks set yet");
});

// ── Premium page ───────────────────────────────────────────────────

test("premium page shows upgrade CTA for non-premium users", async ({ page }) => {
  await setupSettingsPage(page);

  await page.locator(".nav-item", { hasText: "Premium" }).click();

  const activePage = page.locator(".page.active");
  await expect(activePage.locator(".premium-status")).toHaveText("Upgrade to Premium");
  await expect(activePage.locator(".upgrade-btn")).toBeEnabled();
});

test("premium page shows active status for premium users", async ({ page }) => {
  await setupSettingsPage(page, { isPremium: true });

  await page.locator(".nav-item", { hasText: "Premium" }).click();

  const activePage = page.locator(".page.active");
  await expect(activePage.locator(".premium-status")).toHaveText("You're on Premium");
  await expect(activePage.locator(".upgrade-btn")).toBeDisabled();
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

  // The page should reactively re-render with premium status
  await expect(pill).toContainText("Premium");
});
