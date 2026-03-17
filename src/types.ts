// Shared types for Vimium — used across all modules.

export type KeyBindingMode = "location" | "character";
export type Theme = "classic" | "dark" | "light" | "auto";

export interface VimiumSettings {
  keyBindingMode: KeyBindingMode;
  theme: Theme;
  animate: boolean;
  debug: boolean;
}

export const DEFAULTS: VimiumSettings = {
  theme: "auto",
  keyBindingMode: "location",
  animate: true,
  debug: false,
};

export function resolveSettings(storage: Record<string, unknown>): VimiumSettings {
  return {
    ...DEFAULTS,
    ...(storage.keyBindingMode !== undefined && { keyBindingMode: storage.keyBindingMode as KeyBindingMode }),
    ...(storage.theme !== undefined && { theme: storage.theme as Theme }),
    ...(storage.animate !== undefined && { animate: storage.animate as boolean }),
    ...(storage.debug !== undefined && { debug: storage.debug as boolean }),
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
