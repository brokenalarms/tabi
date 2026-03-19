// Test harness entry point — exposes HintMode and KeyHandler as globals
// for Playwright integration tests. Built by esbuild before tests run.

import { KeyHandler } from "../../src/modules/KeyHandler";
import { HintMode } from "../../src/modules/HintMode";
import { HelpOverlay } from "../../src/modules/HelpOverlay";
import { TabSearch } from "../../src/modules/TabSearch";
import { Mode } from "../../src/commands";
import { walkerFilter } from "../../src/modules/ElementGatherer";
import {
  isExcludedByIntent, childrenCannotBeVisible, isOnScreen, isVisible,
  isClippedByOverflow, isOccluded, hasBox,
} from "../../src/modules/elementPredicates";

declare global {
  interface Window {
    TestHarness: {
      KeyHandler: typeof KeyHandler;
      HintMode: typeof HintMode;
      HelpOverlay: typeof HelpOverlay;
      TabSearch: typeof TabSearch;
      Mode: typeof Mode;
      walkerFilter: typeof walkerFilter;
      predicates: {
        isExcludedByIntent: typeof isExcludedByIntent;
        childrenCannotBeVisible: typeof childrenCannotBeVisible;
        isOnScreen: typeof isOnScreen;
        isVisible: typeof isVisible;
        isClippedByOverflow: typeof isClippedByOverflow;
        isOccluded: typeof isOccluded;
        hasBox: typeof hasBox;
      };
    };
  }
}

window.TestHarness = {
  KeyHandler, HintMode, HelpOverlay, TabSearch, Mode, walkerFilter,
  predicates: {
    isExcludedByIntent, childrenCannotBeVisible, isOnScreen, isVisible,
    isClippedByOverflow, isOccluded, hasBox,
  },
};
