# StoreKit IAP + Premium Gating

## Problem

Tabi has no monetization. We're introducing a freemium model where basic hint-mode navigation remains free, and premium features (fuzzy tab search, yank mode, quick marks, one-handed layouts, statistics, multi-open) require a one-time IAP.

## Solution

Apple StoreKit 2 in the host app, with entitlement state bridged to the extension via app group UserDefaults and native messaging. The TypeScript side gates premium features with a lightweight `premium.ts` module and shows a dismissible upgrade toast when free users trigger a premium feature.

## Free vs Premium

**Free tier:**
- Hint mode (`f` / `F` for click)
- Scroll navigation (hjkl, d/u paging, gg/G)
- Basic tab switching (next/previous)
- Help overlay (`?`)
- Vim layout
- Optimized layout (default)

**Premium tier:**
- Fuzzy tab search (upgraded from prefix/substring to fzf-style)
- Yank mode (`y`)
- Multi-open (`Shift+F`, moved from `m`)
- Quick marks (`m` + letter to set, `'` + letter to jump)
- Left-hand and right-hand key layouts
- Statistics dashboard + weekly notification
- Tab close from search (Ctrl+X)

## Implementation

### Swift Layer — StoreManager.swift

New `Tabi/Host App/StoreManager.swift`:
- StoreKit 2 `Product.products(for:)` with product ID `com.brokenalarms.tabi.premium`
- `purchase()` → `Product.purchase()`, verify transaction
- `Transaction.currentEntitlements` observation on app launch
- Writes `isPremium: Bool` to app group UserDefaults (`group.com.brokenalarms.tabi`)
- `@Published var isPremium: Bool` for SwiftUI binding

### Swift Layer — ContentView.swift

- Display premium status badge
- Purchase button (amber gradient, matches hint tag style)
- Restore purchases button
- Status updates live via StoreManager observation

### Native Messaging Bridge

**SafariWebExtensionHandler.swift** — include `isPremium` in `getSettings` response:
```swift
"isPremium": UserDefaults(suiteName: "group.com.brokenalarms.tabi")?.bool(forKey: "isPremium") ?? false
```

**background.ts** — `syncSettings()` already syncs settings; `isPremium` is just another field stored in `browser.storage.local`.

### TypeScript — premium.ts

```typescript
let premiumActive = false;

export function isPremiumActive(): boolean { return premiumActive; }
export function setPremiumStatus(status: boolean): void { premiumActive = status; }
export function guardPremium(featureName: string): boolean {
  if (premiumActive) return true;
  showPremiumPrompt(featureName);
  return false;
}
```

`showPremiumPrompt(featureName)` creates a dismissible toast overlay:
- Amber accent border, blur backdrop (matches existing overlay style from `tabi-theme.css`)
- Shows feature name + "Upgrade in the Tabi app" CTA
- Dismisses on Escape or after 5 seconds
- Styled via `premium.css` added to manifest content_scripts

### Gating Points

Each premium feature calls `guardPremium()` at its entry point:
- `KeyHandler` command dispatch for yank, multi-open, quick marks
- `TabSearch` constructor or mode entry for fuzzy upgrade
- `Statistics` recording calls (silently no-op, no toast)
- Layout switching for left-hand/right-hand

### content.ts Integration

- Read `isPremium` from `browser.storage.local` at init
- Call `setPremiumStatus()`
- Listen on `browser.storage.onChanged` for live updates

## Acceptance Criteria

- StoreKit purchase flow works in sandbox environment
- Premium status persists across app/extension restarts
- Free users see upgrade toast when triggering premium features (not on every keystroke — only on mode entry)
- Free tab search still works with basic prefix/substring scoring
- Free hint mode works normally (no yank, no multi)
- Premium users see no toasts, all features unlocked
- Graceful degradation: if native messaging fails, default to free (never lock out incorrectly)
