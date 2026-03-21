// Single source of truth for global constants.

export const Mode = {
  NORMAL: "NORMAL",
  INSERT: "INSERT",
  HINTS: "HINTS",
  TAB_SEARCH: "TAB_SEARCH",
  MARK: "MARK",
} as const;

export const PREMIUM_COMMANDS = new Set([
  "openTabSearch",
  "setMark",
  "jumpMark",
]);

export type CommandCategory = "hints" | "scroll" | "page" | "tabs" | "actions" | "marks";

export const COMMAND_CATEGORIES: Record<string, CommandCategory> = {
  activateHints: "hints",
  multiOpen: "hints",
  yankLink: "hints",
  scrollDown: "scroll",
  scrollUp: "scroll",
  scrollLeft: "scroll",
  scrollRight: "scroll",
  scrollHalfPageDown: "page",
  scrollHalfPageUp: "page",
  scrollToBottom: "page",
  scrollToTop: "page",
  createTab: "tabs",
  openTabSearch: "tabs",
  closeTab: "tabs",
  restoreTab: "tabs",
  tabLeft: "tabs",
  tabRight: "tabs",
  tabNext: "tabs",
  tabPrev: "tabs",
  goBack: "actions",
  goForward: "actions",
  pageRefresh: "actions",
  showHelp: "actions",
  focusInput: "actions",
  goUpUrl: "actions",
  setMark: "marks",
  jumpMark: "marks",
};

export const CATEGORY_LABELS: { cat: CommandCategory; label: string }[] = [
  { cat: "hints", label: "Hints" },
  { cat: "scroll", label: "Scroll" },
  { cat: "page", label: "Page" },
  { cat: "tabs", label: "Tabs" },
  { cat: "actions", label: "Actions" },
  { cat: "marks", label: "Marks" },
];

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
  multiOpen: "Batch-open links (new tabs)",
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
