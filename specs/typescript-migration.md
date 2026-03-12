# TypeScript Migration

## Problem

The JS codebase uses `_underscore` fake-privacy throughout. There's no type safety, no compile-time checking, and no way to enforce interfaces between modules. This makes subsequent feature work (settings sync, key binding modes, themes) harder to implement correctly.

## Solution

Migrate all JS modules to TypeScript with strict mode, using esbuild for fast compilation. The compiled JS output replaces the current hand-written JS files.

## Implementation

### Build Pipeline

- `tsconfig.json` at project root: target ES2020, strict mode, module ES2020
- esbuild compiles `src/**/*.ts` → `Vimium/Safari Extension/Resources/` (same output paths as current JS)
- Source `.ts` files live in a `src/` directory mirroring the current structure
- `npm run build` or Makefile target for compilation
- manifest.json references the compiled `.js` output (paths unchanged from current)

### Migration Order

Each module is migrated one at a time. KeyHandler first (defines Mode enum and types used by all other modules), then the remaining content script modules (can be parallel since they only depend on KeyHandler types), then background.js, then content.js.

1. **KeyHandler.ts** — `Mode` as const enum, private methods, `KeyBindingMode` type
2. **ScrollController.ts** — typed constructor, axis type `'x' | 'y'`
3. **HintMode.ts** — typed DOM refs, hint interface `{ element, label, div }`
4. **FindMode.ts** — typed DOM refs
5. **TabSearch.ts** — `TabInfo` interface, typed scoring
6. **background.ts** — `CommandMessage` discriminated union, typed handler
7. **content.ts** — `VimiumSettings` interface, typed initialization

### Key Types

```typescript
type KeyBindingMode = "location" | "character";
type Theme = "yellow" | "dark" | "light" | "auto";

interface VimiumSettings {
    excludedDomains: string[];
    keyBindingMode: KeyBindingMode;
    theme: Theme;
}

interface TabInfo {
    id: number;
    title: string;
    url: string;
    active: boolean;
}

type CommandMessage =
    | { command: "createTab"; url?: string }
    | { command: "closeTab" }
    | { command: "switchTab"; tabId: number }
    | { command: "queryTabs" }
    | { command: "syncSettings" }
    | { command: "restoreTab" }
    | { command: "tabLeft" } | { command: "tabRight" }
    | { command: "tabNext" } | { command: "tabPrev" }
    | { command: "firstTab" } | { command: "lastTab" }
    | { command: "extensionActive" } | { command: "extensionInactive" }
```

### Test Compatibility

All modules currently export via `globalThis` for Node.js tests. The TS migration must preserve this pattern so existing tests continue to work without modification. Tests remain as `.js` files importing from `globalThis`.

## Acceptance Criteria

- All `.ts` files compile cleanly with `strict: true`
- Build produces JS output identical in behavior to current code
- All existing tests pass without modification
- No runtime regressions in Safari
- `_underscore` methods use TypeScript `private` access modifiers
- Shared types (`VimiumSettings`, `TabInfo`, `CommandMessage`, `Mode`) are defined and used
