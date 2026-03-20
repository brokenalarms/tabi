// Single source of truth for global constants.

export const Mode = {
  NORMAL: "NORMAL",
  INSERT: "INSERT",
  HINTS: "HINTS",
  TAB_SEARCH: "TAB_SEARCH",
} as const;

export const PREMIUM_COMMANDS = new Set([
  "openTabSearch",
  "setMark",
  "jumpMark",
]);

export const COMMANDS: Record<string, string> = {
  scrollDown: "Scroll down",
  scrollUp: "Scroll up",
  scrollLeft: "Scroll left",
  scrollRight: "Scroll right",
  scrollHalfPageDown: "Half page down",
  scrollHalfPageUp: "Half page up",
  scrollToBottom: "Scroll to bottom",
  scrollToTop: "Scroll to top",
  goBack: "Go back",
  goForward: "Go forward",
  pageRefresh: "Refresh page",
  activateHints: "Open link (current tab)",
  yankLink: "Copy link URL (yank)",
  multiOpen: "Multi-open links (new tabs)",
  createTab: "New tab",
  closeTab: "Close tab",
  restoreTab: "Restore tab",
  tabLeft: "Move tab left",
  tabRight: "Move tab right",
  tabNext: "Next tab",
  tabPrev: "Previous tab",
  goToTab: "Go to tab by number",
  openTabSearch: "Search tabs",
  focusInput: "Focus first text input",
  goUpUrl: "Go up one URL level",
  showHelp: "Show this help",
  exitToNormal: "Exit to normal mode",
  setMark: "Set mark (m + a-z)",
  jumpMark: "Jump to mark (' + a-z)",
};
