# Full Settings Page + Popup Refresh

## Problem

The current popup is tiny and can only hold two settings (tag style, key binding mode). Premium features need configuration space: statistics dashboard, quick marks management, layout visualization with keyboard maps, and premium status. The popup can't scale to this.

## Solution

A full-page settings interface (opens in a browser tab) alongside a refreshed popup for quick toggles. The settings page handles everything; the popup is a fast shortcut to tag style + a link to open full settings.

**Design reference**: `mockups/settings.html` (interactive prototype with all pages).

## Architecture — Modular DOM Construction

The settings page MUST use compact, modular DOM construction — NOT sprawling HTML strings. Follow the pattern used in the existing codebase for overlay construction. Build sections as composable functions that return DOM elements:

```typescript
function createStatCard(icon: string, label: string, value: number): HTMLElement { ... }
function createMilestoneMarker(emoji: string, distance: number, fact: string, reached: boolean): HTMLElement { ... }
function createKeyboardRow(keys: KeyCapDef[]): HTMLElement { ... }
```

## Shared Theme System

All UI surfaces (settings page, popup, help overlay, tab search, premium toast, stats notification) draw from a shared set of CSS custom properties prefixed `--tabi-`:

- Surface: `--tabi-bg`, `--tabi-surface`, `--tabi-surface-border`, `--tabi-divider`
- Text: `--tabi-text`, `--tabi-text-secondary`, `--tabi-text-tertiary`
- Accent: `--tabi-accent` (amber), `--tabi-emerald`, `--tabi-blue`, `--tabi-cyan`, `--tabi-purple`, `--tabi-pink`
- Controls: `--tabi-segmented-bg`, `--tabi-segmented-active`
- Overlay: `--tabi-overlay-bg`, `--tabi-overlay-shadow`

These live in a shared `tabi-theme.css` imported by every surface. Dark/light mode via `prefers-color-scheme` media query.

## Settings Page Layout

**Left sidebar** (200px): Settings, Statistics, Quick Marks, Key Layouts, Premium

**Pages:**

### Settings
- **Appearance**: Tag style segmented control (Auto/Dark/Light/Classic) with mode hint color previews below (click=yellow, yank=cyan, multi=green — small mock hint tags showing each mode's color)
- **Notifications**: Weekly stats summary toggle

### Statistics (premium)
- **Hero stat**: "X.X hrs saved" in large amber gradient text
- **4 stat cards** (2×2 grid): Hints Clicked, Tabs Found, Links Yanked, Mouse Distance Saved — each with icon, counter (SF Mono, large), label, and detail line. CSS `@property` count-up animation on load.
- **Distance milestones**: Cumulative vertical track with green progress fill. Emoji markers at real distances:
  - 🧊 6 ft — Trip to the fridge
  - 🐋 100 ft — Blue whale length
  - 🏈 300 ft — Football field
  - 🗼 1,063 ft — Eiffel Tower
  - 🏙 2,717 ft — Burj Khalifa
  - 📍 Current position (amber, glowing)
  - 🏔 29,032 ft — Mt Everest
  - ✈️ 35,000 ft — Cruising altitude
  - 🏃 137,500 ft — Marathon
  - 🧑‍🚀 330,000 ft — Edge of space
  Reached milestones show green checkmarks; upcoming ones are dimmed.
- **Weekly notification preview**: Toast mockup showing format + toggle

### Quick Marks (premium)
- Grid of mark slots (letter key + title + URL + delete button on hover)
- Empty slots shown as dimmed placeholders
- **Add a Mark form** at bottom: single-letter key input + URL input + Add button
- Helper text: keyboard shortcuts for setting/jumping to marks

### Key Layouts
- **Position / Character mode toggle** at top with description of current mode
- **4 layout selector cards**: each shows name, description, mini color-coded keyboard map, and Pro badge where applicable
  - Vim: "Classic hjkl"
  - Optimized: "Home row, both hands" (default, active)
  - Left Hand: "Right on mouse" (Pro)
  - Right Hand: "Left on mouse" (Pro)
- **Full keyboard detail card** below: 3-row keyboard with color-coded keys
- **6-item legend**: Hints, Scroll, Page, Tabs, Actions, Marks
- In Character mode: key labels swap to show detected keyboard layout (e.g., Dvorak)

### Premium
- Status badge (Free / Premium)
- Feature list with Free/Premium badges per item
- Optimized Layout listed as Free
- One-handed Layouts listed as Premium
- Amber gradient "Upgrade to Tabi Premium" CTA button
- "One-time purchase via the App Store" note

## Popup Refresh

Minimal changes to existing popup:
- Add premium status pill in header (top-right, next to "tabi" title)
- Warmer dark mode background (`#1e1e22`)
- Refined segmented controls (pill-style with `--tabi-segmented-bg` background)
- "Open Full Settings" link in footer (opens settings.html in new tab)
- Click premium pill to see Free ↔ Premium state (interactive for demo)

## Implementation Files

- New: `Tabi/Safari Extension/Resources/settings.html` — Minimal HTML shell
- New: `Tabi/Safari Extension/Resources/styles/settings.css` — All settings styling
- New: `Tabi/Safari Extension/Resources/styles/tabi-theme.css` — Shared theme vars (extracted from existing theme patterns in themes.css)
- New: `src/settings.ts` — Entry point: modular DOM builders, storage reads, event wiring
- Modified: `esbuild.config.mjs` — Add `settings.ts` entry point
- Modified: `Tabi/Safari Extension/Resources/manifest.json` — Add settings files
- Modified: `Tabi/Safari Extension/Resources/popup.html` — Premium pill, settings link, spacing
- Modified: `Tabi/Safari Extension/Resources/styles/popup.css` — Refined controls, warmer dark
- Modified: `src/popup.ts` — Premium status display, settings link handler

## Acceptance Criteria

- Settings page opens in a full browser tab from popup link
- All settings changes persist immediately to `browser.storage.local`
- Stats dashboard shows real data from Statistics module
- Milestone graph reflects actual cumulative distance
- Quick marks can be added/deleted from settings page
- Keyboard visualization updates when switching Position ↔ Character mode
- Layout selector shows correct mini keyboard for each layout
- Premium features show lock state for free users
- Both dark and light mode work across all pages
- Popup premium pill reflects current status
- Shared theme vars used consistently (no hardcoded colors)
