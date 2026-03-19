// Shared keybinding presets — consumed by the extension and the marketing site.

export type KeyPreset = "homerow" | "vim";

export interface KeyBinding {
  /** event.code sequence used by KeyHandler, e.g. "KeyJ", "Shift-KeyG" */
  sequence: string;
  /** Command name from COMMANDS registry */
  command: string;
  /** Human-readable key label for display, e.g. "J", "G", "gg" */
  display: string;
}

export interface PresetMeta {
  label: string;
  description: string;
  bindings: KeyBinding[];
}

// ── Helpers ──

function bind(sequence: string, command: string, display: string): KeyBinding {
  return { sequence, command, display };
}

// ── Shared bindings (identical in both presets) ──

const SHARED: KeyBinding[] = [
  // Hints
  bind("KeyF", "activateHints", "F"),
  bind("Shift-KeyF", "activateHintsNewTab", "Shift+F"),
  bind("KeyY", "yankLink", "Y"),
  bind("KeyM", "multiOpen", "M"),

  // Tabs
  bind("KeyT", "createTab", "t"),
  bind("KeyX", "closeTab", "x"),
  bind("Shift-KeyX", "restoreTab", "X"),
  bind("Shift-KeyT", "openTabSearch", "T"),

  // Navigation
  bind("KeyG KeyI", "focusInput", "gi"),
  bind("KeyG KeyU", "goUpUrl", "gu"),

  // Help
  bind("Shift-Slash", "showHelp", "?"),
];

// ── Presets ──

export const PRESETS: Record<KeyPreset, PresetMeta> = {
  homerow: {
    label: "Home Row",
    description: "Shortcuts designed around the home row — no Vim knowledge needed.",
    bindings: [
      ...SHARED,

      // Scrolling
      bind("KeyJ", "scrollDown", "J"),
      bind("KeyK", "scrollUp", "K"),
      bind("KeyH", "scrollLeft", "H"),
      bind("KeyL", "scrollRight", "L"),
      bind("KeyD", "scrollHalfPageDown", "D"),
      bind("KeyU", "scrollHalfPageUp", "U"),
      bind("Shift-KeyG", "scrollToBottom", "Shift+G"),
      bind("KeyG KeyG", "scrollToTop", "gg"),

      // History
      bind("Shift-KeyH", "goBack", "Shift+H"),
      bind("Shift-KeyL", "goForward", "Shift+L"),
      bind("KeyR", "pageRefresh", "R"),

      // Tab movement
      bind("Shift-KeyJ", "tabLeft", "Shift+J"),
      bind("Shift-KeyK", "tabRight", "Shift+K"),
      bind("KeyG KeyT", "tabNext", "gt"),
      bind("KeyG Shift-KeyT", "tabPrev", "gT"),
    ],
  },

  vim: {
    label: "Vim",
    description: "Classic Vim-style keybindings for users who already know the motions.",
    bindings: [
      ...SHARED,

      // Scrolling — same keys, vim heritage
      bind("KeyJ", "scrollDown", "j"),
      bind("KeyK", "scrollUp", "k"),
      bind("KeyH", "scrollLeft", "h"),
      bind("KeyL", "scrollRight", "l"),
      bind("KeyD", "scrollHalfPageDown", "d"),
      bind("KeyU", "scrollHalfPageUp", "u"),
      bind("Shift-KeyG", "scrollToBottom", "G"),
      bind("KeyG KeyG", "scrollToTop", "gg"),

      // History
      bind("Shift-KeyH", "goBack", "H"),
      bind("Shift-KeyL", "goForward", "L"),
      bind("KeyR", "pageRefresh", "r"),

      // Tab movement
      bind("Shift-KeyJ", "tabLeft", "J"),
      bind("Shift-KeyK", "tabRight", "K"),
      bind("KeyG KeyT", "tabNext", "gt"),
      bind("KeyG Shift-KeyT", "tabPrev", "gT"),
    ],
  },
};

/** Look up the display label for a command in a given preset. */
export function displayForCommand(preset: KeyPreset, command: string): string {
  const entry = PRESETS[preset].bindings.find((b) => b.command === command);
  return entry?.display ?? "";
}

/** Get all bindings for a preset as [sequence, command] pairs for KeyHandler. */
export function bindingsForPreset(preset: KeyPreset): Array<[string, string]> {
  return PRESETS[preset].bindings.map((b) => [b.sequence, b.command]);
}
