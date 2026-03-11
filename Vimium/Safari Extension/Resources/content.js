// Vimium content script
// Runs on every page to handle keyboard navigation

(function () {
    "use strict";

    function isDomainExcluded(excludedDomains) {
        const hostname = window.location.hostname.toLowerCase();
        for (const pattern of excludedDomains) {
            if (hostname === pattern || hostname.endsWith("." + pattern)) {
                return true;
            }
        }
        return false;
    }

    function initialize() {
        const keyHandler = new KeyHandler();

        // Scroll and history navigation
        const scrollController = new ScrollController(keyHandler);

        // Link hint navigation
        const hintMode = new HintMode(keyHandler);

        // In-page find
        const findMode = new FindMode(keyHandler);

        // Tab search overlay
        const tabSearch = new TabSearch(keyHandler);

        // Default exitToNormal handler restores NORMAL mode
        keyHandler.on("exitToNormal", () => {
            if (keyHandler.getMode() === Mode.HINTS && hintMode.isActive()) {
                hintMode.deactivate();
                return;
            }
            if (keyHandler.getMode() === Mode.FIND && findMode.isActive()) {
                findMode.deactivate(true);
                return;
            }
            if (keyHandler.getMode() === Mode.TAB_SEARCH && tabSearch.isActive()) {
                tabSearch.deactivate();
                return;
            }
            keyHandler.setMode(Mode.NORMAL);
            const active = document.activeElement;
            if (active && active !== document.body) active.blur();
        });

        // Tab operations — delegate to background service worker
        const tabCommands = [
            "createTab", "closeTab", "restoreTab",
            "tabLeft", "tabRight", "tabNext", "tabPrev",
            "firstTab", "lastTab",
        ];
        for (const cmd of tabCommands) {
            keyHandler.on(cmd, () => {
                browser.runtime.sendMessage({ command: cmd });
            });
        }

        // Expose for other modules (FindMode, TabSearch)
        window.__vimiumKeyHandler = keyHandler;
    }

    // Check exclusion list before activating
    browser.storage.local.get("excludedDomains").then((result) => {
        const excluded = result.excludedDomains || [];
        if (!isDomainExcluded(excluded)) {
            initialize();
        }
    }).catch(() => {
        // If storage read fails, initialize anyway
        initialize();
    });
})();
