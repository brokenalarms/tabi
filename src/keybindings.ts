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
  bind("Shift-KeyF", "multiOpen", "Shift+F"),
  bind("KeyY", "yankLink", "Y"),

  // Tabs
  bind("KeyT", "openTabSearch", "T"),
  bind("KeyX", "closeTab", "x"),
  bind("Shift-KeyX", "restoreTab", "X"),

  // Navigation
  bind("KeyG KeyI", "focusInput", "gi"),
  bind("KeyG KeyU", "goUpUrl", "gu"),

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

  leftHand: {
    label: "Left Hand",
    description: "All shortcuts on the left side of the keyboard — browse one-handed.",
    premium: true,
    bindings: [
      // Scrolling (WASD)
      bind("KeyW", "scrollUp", "W"),
      bind("KeyS", "scrollDown", "S"),
      bind("KeyA", "scrollLeft", "A"),
      bind("KeyD", "scrollRight", "D"),
      bind("KeyQ", "scrollHalfPageUp", "Q"),
      bind("KeyE", "scrollHalfPageDown", "E"),
      bind("Shift-KeyW", "scrollToTop", "Shift+W"),
      bind("Shift-KeyS", "scrollToBottom", "Shift+S"),

      // History
      bind("Shift-KeyA", "goBack", "Shift+A"),
      bind("Shift-KeyD", "goForward", "Shift+D"),
      bind("KeyR", "pageRefresh", "R"),

      // Tab movement
      bind("Shift-KeyQ", "tabLeft", "Shift+Q"),
      bind("Shift-KeyE", "tabRight", "Shift+E"),

      // Hints
      bind("KeyF", "activateHints", "F"),
      bind("Shift-KeyF", "multiOpen", "Shift+F"),
      bind("KeyV", "yankLink", "V"),

      // Tabs
      bind("KeyT", "openTabSearch", "T"),
      bind("KeyX", "closeTab", "x"),
      bind("Shift-KeyX", "restoreTab", "X"),

      // Navigation
      bind("KeyG KeyR", "focusInput", "gr"),
      bind("KeyG KeyC", "goUpUrl", "gc"),

      // Help
      bind("KeyB", "showHelp", "B"),
    ],
  },

  rightHand: {
    label: "Right Hand",
    description: "All shortcuts on the right side of the keyboard — browse one-handed.",
    premium: true,
    bindings: [
      // Scrolling (HJKL)
      bind("KeyJ", "scrollDown", "J"),
      bind("KeyK", "scrollUp", "K"),
      bind("KeyH", "scrollLeft", "H"),
      bind("KeyL", "scrollRight", "L"),
      bind("KeyU", "scrollHalfPageUp", "U"),
      bind("KeyO", "scrollHalfPageDown", "O"),
      bind("Shift-KeyK", "scrollToTop", "Shift+K"),
      bind("Shift-KeyJ", "scrollToBottom", "Shift+J"),

      // History
      bind("Shift-KeyH", "goBack", "Shift+H"),
      bind("Shift-KeyL", "goForward", "Shift+L"),
      bind("KeyN", "pageRefresh", "N"),

      // Tab movement
      bind("Shift-KeyU", "tabLeft", "Shift+U"),
      bind("Shift-KeyO", "tabRight", "Shift+O"),

      // Hints
      bind("Semicolon", "activateHints", ";"),
      bind("Shift-Semicolon", "multiOpen", ":"),
      bind("KeyM", "yankLink", "M"),

      // Tabs
      bind("KeyP", "openTabSearch", "P"),
      bind("Period", "closeTab", "."),
      bind("Shift-Period", "restoreTab", ">"),

      // Navigation
      bind("KeyI", "focusInput", "I"),
      bind("KeyU KeyU", "goUpUrl", "uu"),

      // Help
      bind("Slash", "showHelp", "/"),
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
