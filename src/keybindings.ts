// Shared keybinding presets — consumed by the extension and the marketing site.

import type { KeyLayout } from "./types";

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
  premium?: boolean;
}

// ── Helpers ──

function bind(sequence: string, command: string, display: string): KeyBinding {
  return { sequence, command, display };
}

// ── Shared bindings (identical in optimized and vim) ──

const SHARED: KeyBinding[] = [
  // Hints
  bind("KeyF", "activateHints", "F"),
  bind("KeyB", "multiOpen", "B"),
  bind("KeyY", "yankLink", "Y"),

  // Tabs
  bind("KeyT", "createTab", "t"),
  bind("Shift-KeyT", "openTabSearch", "Shift+T"),
  bind("KeyX", "closeTab", "x"),
  bind("Shift-KeyX", "restoreTab", "X"),
  bind("BracketLeft", "tabHistoryBack", "["),
  bind("BracketRight", "tabHistoryForward", "]"),

  // Help
  bind("Shift-Slash", "showHelp", "?"),
];

// ── Presets ──

export const PRESETS: Record<KeyLayout, PresetMeta> = {
  optimized: {
    label: "Home Row",
    description: "Shortcuts designed around the home row — no Vim knowledge needed.",
    bindings: [
      ...SHARED,

      // Scrolling (right hand home row)
      bind("KeyJ", "scrollDown", "J"),
      bind("KeyK", "scrollUp", "K"),
      bind("KeyH", "scrollLeft", "H"),
      bind("KeyL", "scrollRight", "L"),

      // Page scrolling (left hand: E above D = spatial up/down)
      bind("KeyD", "scrollHalfPageDown", "D"),
      bind("KeyE", "scrollHalfPageUp", "E"),
      bind("Shift-KeyJ", "scrollToBottom", "Shift+J"),
      bind("Shift-KeyK", "scrollToTop", "Shift+K"),

      // History
      bind("Shift-KeyH", "goBack", "Shift+H"),
      bind("Shift-KeyL", "goForward", "Shift+L"),
      bind("KeyR", "pageRefresh", "R"),

      // Tab switching
      bind("KeyN", "tabNext", "N"),
      bind("KeyP", "tabPrev", "P"),
      bind("Shift-Comma", "tabLeft", "<"),
      bind("Shift-Period", "tabRight", ">"),

      // Navigation (single key — no sequences)
      bind("KeyI", "focusInput", "I"),
      bind("KeyU", "goUpUrl", "U"),

      // Marks
      bind("KeyM", "setMark", "M"),
      bind("Semicolon", "jumpMark", ";"),
    ],
  },

  vim: {
    label: "Vim",
    description: "Classic Vim-style keybindings for users who already know the motions.",
    bindings: [
      ...SHARED,

      // Scrolling
      bind("KeyJ", "scrollDown", "j"),
      bind("KeyK", "scrollUp", "k"),
      bind("KeyH", "scrollLeft", "h"),
      bind("KeyL", "scrollRight", "l"),
      bind("KeyD", "scrollHalfPageDown", "d"),
      bind("KeyU", "scrollHalfPageUp", "u"),
      bind("Shift-KeyG", "scrollToBottom", "G"),
      bind("Shift-KeyK", "scrollToTop", "Shift+K"),

      // History
      bind("Shift-KeyH", "goBack", "H"),
      bind("Shift-KeyL", "goForward", "L"),
      bind("KeyR", "pageRefresh", "r"),

      // Tab switching
      bind("KeyN", "tabNext", "n"),
      bind("KeyP", "tabPrev", "p"),
      bind("Shift-Comma", "tabLeft", "<"),
      bind("Shift-Period", "tabRight", ">"),

      // Navigation (single key — no sequences)
      bind("KeyI", "focusInput", "I"),
      bind("Shift-KeyU", "goUpUrl", "Shift+U"),

      // Marks
      bind("KeyM", "setMark", "m"),
      bind("Quote", "jumpMark", "'"),
    ],
  },

  leftHand: {
    label: "Left Hand",
    description: "All shortcuts on the left side of the keyboard — browse one-handed.",
    premium: true,
    bindings: [
      // Navigation 3×3 (WASD grid)
      bind("KeyQ", "scrollToTop", "Q"),
      bind("KeyW", "scrollUp", "W"),
      bind("KeyE", "scrollHalfPageUp", "E"),
      bind("KeyA", "scrollLeft", "A"),
      bind("KeyS", "scrollDown", "S"),
      bind("KeyD", "scrollRight", "D"),
      bind("KeyZ", "scrollToBottom", "Z"),
      bind("KeyX", "focusInput", "X"),
      bind("KeyC", "scrollHalfPageDown", "C"),

      // Shift-navigation (directional analogs)
      bind("Shift-KeyQ", "tabLeft", "Shift+Q"),
      bind("Shift-KeyW", "tabPrev", "Shift+W"),
      bind("Shift-KeyE", "tabRight", "Shift+E"),
      bind("Shift-KeyA", "goBack", "Shift+A"),
      bind("Shift-KeyS", "tabNext", "Shift+S"),
      bind("Shift-KeyD", "goForward", "Shift+D"),
      bind("Shift-KeyZ", "tabHistoryBack", "Shift+Z"),
      bind("Shift-KeyX", "closeTab", "Shift+X"),
      bind("Shift-KeyC", "tabHistoryForward", "Shift+C"),

      // Actions (columns right of navigation)
      bind("KeyR", "pageRefresh", "R"),
      bind("KeyF", "activateHints", "F"),
      bind("KeyV", "yankLink", "V"),
      bind("KeyT", "createTab", "T"),
      bind("KeyG", "goUpUrl", "G"),
      bind("KeyB", "multiOpen", "B"),

      // Shift-actions
      bind("Shift-KeyR", "restoreTab", "Shift+R"),
      bind("Shift-KeyF", "setMark", "Shift+F"),
      bind("Shift-KeyT", "openTabSearch", "Shift+T"),
      bind("Shift-KeyG", "jumpMark", "Shift+G"),

      // Help
      bind("Shift-Slash", "showHelp", "?"),
    ],
  },

  rightHand: {
    label: "Right Hand",
    description: "All shortcuts on the right side of the keyboard — browse one-handed.",
    premium: true,
    bindings: [
      // Navigation 3×3 (mirror of WASD)
      bind("KeyU", "scrollHalfPageUp", "U"),
      bind("KeyI", "scrollUp", "I"),
      bind("KeyO", "scrollToTop", "O"),
      bind("KeyJ", "scrollLeft", "J"),
      bind("KeyK", "scrollDown", "K"),
      bind("KeyL", "scrollRight", "L"),
      bind("KeyM", "scrollHalfPageDown", "M"),
      bind("Comma", "focusInput", ","),
      bind("Period", "scrollToBottom", "."),

      // Shift-navigation (directional analogs)
      bind("Shift-KeyU", "tabLeft", "Shift+U"),
      bind("Shift-KeyI", "tabPrev", "Shift+I"),
      bind("Shift-KeyO", "tabRight", "Shift+O"),
      bind("Shift-KeyJ", "goBack", "Shift+J"),
      bind("Shift-KeyK", "tabNext", "Shift+K"),
      bind("Shift-KeyL", "goForward", "Shift+L"),
      bind("Shift-KeyM", "tabHistoryBack", "Shift+M"),
      bind("Shift-Comma", "closeTab", "<"),
      bind("Shift-Period", "tabHistoryForward", ">"),

      // Actions (columns left of navigation, toward center)
      bind("KeyY", "yankLink", "Y"),
      bind("KeyH", "activateHints", "H"),
      bind("KeyN", "multiOpen", "N"),

      // Secondary actions (right pinky column)
      bind("KeyP", "createTab", "P"),
      bind("Semicolon", "goUpUrl", ";"),

      // Shift-actions
      bind("Shift-KeyY", "restoreTab", "Shift+Y"),
      bind("Shift-KeyH", "pageRefresh", "Shift+H"),
      bind("Shift-KeyP", "openTabSearch", "Shift+P"),
      bind("Shift-Semicolon", "setMark", ":"),
      bind("Quote", "jumpMark", "'"),

      // Help
      bind("Shift-Slash", "showHelp", "?"),
    ],
  },
};

/** Look up the display label for a command in a given layout. */
export function displayForCommand(layout: KeyLayout, command: string): string {
  const entry = PRESETS[layout].bindings.find((b) => b.command === command);
  return entry?.display ?? "";
}

/** Get all bindings for a layout as [sequence, command] pairs for KeyHandler. */
export function bindingsForPreset(layout: KeyLayout): Array<[string, string]> {
  return PRESETS[layout].bindings.map((b) => [b.sequence, b.command]);
}

/** Whether a layout requires premium. */
export function isLayoutPremium(layout: KeyLayout): boolean {
  return PRESETS[layout].premium === true;
}

// QWERTY keyboard rows for visualization (null = invisible spacer for rectangle fill)
export const KB_ROWS: (string | null)[][] = [
  ["q", "w", "e", "r", "t", "y", "u", "i", "o", "p", "[", "]"],
  ["a", "s", "d", "f", "g", "h", "j", "k", "l", ";", "'", null],
  ["z", "x", "c", "v", "b", "n", "m", ",", ".", "/", null, null],
];
