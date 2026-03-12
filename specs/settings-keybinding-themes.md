# Settings UI, Key Binding Mode, and Theme System

## Problem

The host app settings only support excluded domains. Users on non-QWERTY layouts (Dvorak, Colemak) can't use the extension because key bindings are positional (event.code). There's no theme support — the yellow hint style is hardcoded.

## Solution

Add a settings pipeline that syncs key binding mode and theme preferences from the host app through to the extension. Add character-based key binding mode for non-QWERTY users. Add a theme system with yellow (default), dark, light, and auto options.

## Implementation

### Swift Layer (SettingsManager + Handler)

**SettingsManager.swift** — add two new UserDefaults properties:
- `keyBindingMode: String` — `"location"` (default) or `"character"`
- `theme: String` — `"yellow"` (default), `"dark"`, `"light"`, or `"auto"`

**SafariWebExtensionHandler.swift** — add `"getSettings"` command that returns all settings:
```swift
case "getSettings":
    responseData = [
        "excludedDomains": settings.excludedDomains,
        "keyBindingMode": settings.keyBindingMode,
        "theme": settings.theme
    ]
```

### Background Settings Sync

Rename `syncExcludedDomains()` → `syncSettings()`. Use `"getSettings"` native message. Store all values in `browser.storage.local`. Validate with `VimiumSettings` type, fallback to defaults for bad values. Handle `"settingsChanged"` dispatchMessage for live re-sync.

### Key Binding Mode (KeyHandler.ts)

Add `private keyBindingMode: KeyBindingMode` and `setKeyBindingMode()` setter.

Character mode logic in `normalizeKey`:
- **Letters**: `event.key` `'a'`-`'z'` → `"KeyA"`-`"KeyZ"`. Shift detected via `event.shiftKey`.
- **Digits**: `event.key` `'0'`-`'9'` → `"Digit0"`-`"Digit9"`.
- **Everything else** (symbols, special keys): use `event.code` directly. Symbols are position-stable across Latin layouts.

Location mode (default): unchanged behavior, always `event.code`.

### Theme CSS System

**New file: `styles/themes.css`** — CSS custom properties scoped to Vimium classes (NOT `:root`):

```css
.vimium-hint-overlay, .vimium-find-bar, .vimium-tab-search-overlay {
    /* yellow defaults via --vimium-* vars */
}
[data-vimium-theme="dark"] .vimium-hint-overlay, ... { /* dark */ }
[data-vimium-theme="light"] .vimium-hint-overlay, ... { /* light */ }
@media (prefers-color-scheme: dark) {
    [data-vimium-theme="auto"] ... { /* = dark */ }
}
@media (prefers-color-scheme: light) {
    [data-vimium-theme="auto"] ... { /* = light */ }
}
```

Update `hints.css`, `find.css`, `tab-search.css` to use `var(--vimium-*)` variables. Add `themes.css` first in manifest.json css array.

Do NOT remove inline `_injectStyles()` — separate cleanup concern.

### Content Script Integration

Read all settings from `browser.storage.local.get(["excludedDomains", "keyBindingMode", "theme"])`. Apply theme via `data-vimium-theme` attribute on `document.documentElement`. Wire `keyHandler.setKeyBindingMode(mode)`. Add `browser.storage.onChanged` listener for live updates.

### Host App UI (ContentView.swift)

Redesign Settings tab:
- **Key Binding Mode** — Segmented picker: "By Position" / "By Character"
  - Help text: "Position matches physical key location (same across layouts). Character matches what you type (for Dvorak, Colemak, etc.)"
- **Theme** — Segmented picker: "Yellow" / "Dark" / "Light" / "Auto"
- **Excluded Domains** — Keep existing UI, add tip about Safari per-site access

Live sync: After any change, call `SFSafariApplication.dispatchMessage(withName: "settingsChanged", toExtensionWithIdentifier:)`.

## Acceptance Criteria

- Theme change in host app updates hints/find/tab-search live (no page reload)
- Auto theme follows macOS dark/light appearance
- Character mode: Dvorak j/k/h/l match typed characters, not physical position
- Symbols (`/` for find) still work in Character mode (uses `event.code`)
- Excluded domains still work
- Invalid settings values handled gracefully (default fallbacks)
- Settings survive extension restart (persisted in UserDefaults + storage.local)
