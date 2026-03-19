// Shared types for Tabi — used across all modules.

export type KeyBindingMode = "location" | "character";
export type Theme = "classic" | "dark" | "light" | "auto";

export interface TabiSettings {
  keyBindingMode: KeyBindingMode;
  theme: Theme;
  animate: boolean;
}

export const DEFAULTS: TabiSettings = {
  theme: "auto",
  keyBindingMode: "location",
  animate: true,
};

/** Build-time debug flag — set via TABI_DEBUG=1 in .env or environment. */
declare const __TABI_DEBUG__: boolean;
export const DEBUG: boolean = typeof __TABI_DEBUG__ !== "undefined" ? __TABI_DEBUG__ : false;

export function resolveSettings(storage: Record<string, unknown>): TabiSettings {
  return {
    ...DEFAULTS,
    ...(storage.keyBindingMode !== undefined && { keyBindingMode: storage.keyBindingMode as KeyBindingMode }),
    ...(storage.theme !== undefined && { theme: storage.theme as Theme }),
    ...(storage.animate !== undefined && { animate: storage.animate as boolean }),
  };
}

export interface TabInfo {
  id: number;
  title: string;
  url: string;
  active: boolean;
}

export type CommandMessage =
  | { command: "createTab"; url?: string }
  | { command: "closeTab" }
  | { command: "switchTab"; tabId: number }
  | { command: "queryTabs" }
  | { command: "syncSettings" }
  | { command: "restoreTab" }
  | { command: "tabLeft" }
  | { command: "tabRight" }
  | { command: "tabNext" }
  | { command: "tabPrev" }
  | { command: "goToTab"; index: number }
  | { command: "goToTabFirst" }
  | { command: "goToTabLast" }
  | { command: "extensionActive" }
  | { command: "extensionInactive" };

export type ModeValue = "NORMAL" | "INSERT" | "HINTS" | "TAB_SEARCH";
