// Single source of truth for global constants.
// Loaded first in manifest.json — all other content scripts access via globalThis.

const Mode = {
  NORMAL: "NORMAL",
  INSERT: "INSERT",
  HINTS: "HINTS",
  FIND: "FIND",
  TAB_SEARCH: "TAB_SEARCH",
} as const;

const COMMANDS: Record<string, string> = {
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
  activateHintsNewTab: "Open link (new tab)",
  enterFindMode: "Find on page (Cmd+F)",
  createTab: "New tab",
  closeTab: "Close tab",
  restoreTab: "Restore tab",
  tabLeft: "Move tab left",
  tabRight: "Move tab right",
  tabNext: "Next tab",
  tabPrev: "Previous tab",
  firstTab: "First tab",
  lastTab: "Last tab",
  openTabSearch: "Search tabs",
  focusInput: "Focus first text input",
  goUpUrl: "Go up one URL level",
  showHelp: "Show this help",
  exitToNormal: "Exit to normal mode",
};

// Export for Node.js tests and content script global access
if (typeof globalThis !== "undefined") {
  (globalThis as Record<string, unknown>).Mode = Mode;
  (globalThis as Record<string, unknown>).COMMANDS = COMMANDS;
}
