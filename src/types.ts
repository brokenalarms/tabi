// Shared types for Vimium — used across all modules.

export type KeyBindingMode = "location" | "character";
export type Theme = "classic" | "dark" | "light" | "auto";

export interface VimiumSettings {
  keyBindingMode: KeyBindingMode;
  theme: Theme;
  enablePointerTails: string;
  animate: boolean;
}

export const DEFAULTS: VimiumSettings = {
  theme: "auto",
  enablePointerTails: "true",
  keyBindingMode: "location",
  animate: true,
};

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

export type ModeValue = "NORMAL" | "INSERT" | "HINTS" | "FIND" | "TAB_SEARCH";
