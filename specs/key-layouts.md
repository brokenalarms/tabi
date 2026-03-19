# Modern Home-Row Key Layouts

## Problem

The current Vim-style keybindings (hjkl) are familiar to Vim users but unintuitive for everyone else. Users who browse with one hand on the mouse need all commands reachable by the other hand. There's no way to customize the command layout.

## Solution

Four position-based layouts: **Vim** (classic hjkl), **Optimized** (full keyboard, both hands near home row), **Left Hand** (right hand on mouse), and **Right Hand** (left hand on mouse). Vim and Optimized are free; Left/Right Hand are premium.

**Optimized is the default for new users.** Vim is available for those who prefer it.

## Design Principles

- **Home row first**: Most-used commands (hints, scroll) on home row keys
- **Spatial grouping**: Scroll cluster, tab cluster, action cluster, mark cluster grouped logically
- **Six command categories** with distinct colors in the UI:
  - 🟡 **Hints** (amber): Enter hint modes (click, yank, multi-open)
  - 🟢 **Scroll** (emerald): Line-by-line movement (hjkl equivalent)
  - 🔵 **Page** (cyan): Half-page, top/bottom jumps (d/u/gg/G equivalent)
  - 🔷 **Tabs** (blue): Tab search, next/prev tab
  - 🟣 **Actions** (purple): Yank, help, refresh, history
  - 🩷 **Marks** (pink): Set mark, jump to mark

## Mode-Specific Hint Colors

Each hint mode uses a distinct tag color so the user knows what mode they're in at a glance:
- **Click mode** (`f`): Classic yellow/amber gradient (existing)
- **Yank mode** (`y`): Cyan/teal gradient
- **Multi-open mode** (`Shift+F`): Lime/green gradient

Each has dark and light variants that follow the Tag Style setting (auto/dark/light/classic).

## Layout Definitions

Each layout is a plain object in `src/modules/keyLayouts.ts` mapping `KeyCode → command`. The current `initDefaultBindings()` in KeyHandler becomes the `vim` layout.

```typescript
interface KeyLayout {
  name: string;
  label: string;           // "Vim", "Optimized", "Left Hand", "Right Hand"
  description: string;
  free: boolean;
  bindings: Record<string, string>;        // KeyCode → command (normal mode)
  shiftBindings: Record<string, string>;   // KeyCode → command (with shift)
  sequences: Record<string, string>;       // "KeyG KeyG" → command (multi-key)
}
```

### Vim Layout (free)
Classic layout. Current default bindings refactored into this format.

### Optimized Layout (free, new default)
Both hands near home row. Symmetric groupings where possible. All commands accessible without leaving home position.

### Left Hand Layout (premium)
All commands on left half of keyboard (q–g, a–f, z–v rows). Right hand stays on mouse.

### Right Hand Layout (premium)
Mirror of left hand. All commands on right half (y–p, h–;, b–/ rows). Left hand stays on mouse.

## Keyboard Layout Detection (Character Mode)

In **Position mode** (default): bindings use `event.code` (physical key position). The keyboard visualization always shows QWERTY labels. Works identically on any keyboard.

In **Character mode**: bindings use `event.key` (typed character). The keyboard visualization must show the user's actual layout so they can see which *physical* key produces which command.

### Detection approach

Safari doesn't support `navigator.keyboard.getLayoutMap()`. Instead:

1. **Native messaging bridge**: The Swift side reads the active keyboard input source via `TISCopyCurrentKeyboardInputSource()` and returns the layout identifier (e.g., `com.apple.keylayout.Dvorak`).
2. **Known layout maps**: A lookup table maps common layout identifiers to their character→position mappings (QWERTY, Dvorak, Colemak, AZERTY, QWERTZ).
3. **Fallback**: If the layout isn't recognized, show QWERTY labels with a note that character positions may differ.
4. **Live update**: When the user switches keyboard layouts in macOS, the extension re-queries via native messaging.

The settings page Position/Character toggle updates the keyboard visualization in real time.

## KeyHandler Integration

```typescript
// KeyHandler.ts
setLayout(name: string): void {
  this.clearAllBindings();
  const layout = getLayout(name);  // from keyLayouts.ts
  this.registerBindings(layout);
}
```

`initDefaultBindings()` becomes `setLayout("optimized")` for new installs. Existing users who haven't changed settings keep vim (migration: if `keyLayout` is unset in storage, check if `keyBindingMode` exists → vim user, otherwise → optimized).

## Implementation Files

- New: `src/modules/keyLayouts.ts` — Layout definitions as plain objects
- Modified: `src/modules/KeyHandler.ts` — `setLayout()`, clear+re-register
- Modified: `src/types.ts` — `keyLayout: "vim" | "optimized" | "leftHand" | "rightHand"`
- Modified: `src/content.ts` — Read layout from storage, apply, listen for changes
- Modified: `Tabi/Safari Extension/Resources/styles/themes.css` — Mode-specific hint colors
- Modified: `Tabi/Safari Extension/SafariWebExtensionHandler.swift` — Keyboard layout detection

## Acceptance Criteria

- Switching layouts re-registers all keybindings without page reload
- All commands work identically across layouts (just different physical keys)
- Mode bar and help overlay automatically reflect the active layout's bindings
- Character mode shows correct key labels for detected keyboard layout
- Vim and Optimized available without premium
- Left/Right Hand show premium prompt when selected by free users
- Hint tags change color based on mode (click=yellow, yank=cyan, multi=green)
- Existing vim users aren't forced to switch on upgrade
