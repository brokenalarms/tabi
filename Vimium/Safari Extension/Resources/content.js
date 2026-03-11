// Vimium content script
// Runs on every page to handle keyboard navigation

(function () {
    "use strict";

    const keyHandler = new KeyHandler();

    // Scroll and history navigation
    const scrollController = new ScrollController(keyHandler);

    // Link hint navigation
    const hintMode = new HintMode(keyHandler);

    // In-page find
    const findMode = new FindMode(keyHandler);

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
})();
