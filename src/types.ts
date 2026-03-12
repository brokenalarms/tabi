// Shared types for Vimium — used across all modules.

export type KeyBindingMode = "location" | "character";
export type Theme = "yellow" | "dark" | "light" | "auto";

export interface VimiumSettings {
  excludedDomains: string[];
  keyBindingMode: KeyBindingMode;
  theme: Theme;
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
  | { command: "firstTab" }
  | { command: "lastTab" }
  | { command: "extensionActive" }
  | { command: "extensionInactive" };

export const Mode = {
  NORMAL: "NORMAL",
  INSERT: "INSERT",
  HINTS: "HINTS",
  FIND: "FIND",
  TAB_SEARCH: "TAB_SEARCH",
} as const;

export type ModeValue = (typeof Mode)[keyof typeof Mode];
