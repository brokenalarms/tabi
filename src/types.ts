// Shared types for Tabi — used across all modules.

export type KeyBindingMode = "location" | "character";
export type KeyLayout = "optimized" | "vim" | "leftHand" | "rightHand";
export type Theme = "classic" | "dark" | "light" | "auto";

export interface TabiSettings {
  keyBindingMode: KeyBindingMode;
  keyLayout: KeyLayout;
  theme: Theme;
  animate: boolean;
  isPremium: boolean;
  autoNotifications: boolean;
}

export const DEFAULTS: TabiSettings = {
  theme: "auto",
  keyBindingMode: "location",
  keyLayout: "optimized",
  animate: true,
  isPremium: false,
  autoNotifications: true,
};

/** Build-time debug flag — set via TABI_DEBUG=1 in .env or environment. */
declare const __TABI_DEBUG__: boolean;
export const DEBUG: boolean = typeof __TABI_DEBUG__ !== "undefined" ? __TABI_DEBUG__ : false;

/** Build-time premium override — set via TABI_PREMIUM=1 in .env or environment. */
declare const __TABI_PREMIUM__: boolean;
export const FORCE_PREMIUM: boolean = typeof __TABI_PREMIUM__ !== "undefined" ? __TABI_PREMIUM__ : false;

export function resolvePremiumStatus(storage: Record<string, unknown>, debug: boolean): boolean {
  if (debug) {
    return storage.debugPremium !== undefined ? (storage.debugPremium as boolean) : true;
  }
  return FORCE_PREMIUM || storage.isPremium === true;
}

export function resolveSettings(storage: Record<string, unknown>): TabiSettings {
  return {
    ...DEFAULTS,
    ...(storage.keyBindingMode !== undefined && { keyBindingMode: storage.keyBindingMode as KeyBindingMode }),
    ...(storage.keyLayout !== undefined && { keyLayout: storage.keyLayout as KeyLayout }),
    ...(storage.theme !== undefined && { theme: storage.theme as Theme }),
    ...(storage.animate !== undefined && { animate: storage.animate as boolean }),
    ...(storage.isPremium !== undefined && { isPremium: storage.isPremium as boolean }),
    ...(storage.autoNotifications !== undefined && { autoNotifications: storage.autoNotifications as boolean }),
    ...(FORCE_PREMIUM && { isPremium: true }),
  };
}

export interface TabInfo {
  id: number;
  title: string;
  url: string;
  active: boolean;
  favIconUrl?: string;
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
  | { command: "extensionInactive" }
  | { command: "jumpToMark"; url: string; scrollY: number; reuseTab: boolean }
  | { command: "tabHistoryBack" }
  | { command: "tabHistoryForward" };

export type ModeValue = "NORMAL" | "INSERT" | "HINTS" | "TAB_SEARCH" | "MARK";
