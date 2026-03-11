// Vimium content script
// Runs on every page to handle keyboard navigation

(function () {
    "use strict";

    const keyHandler = new KeyHandler();

    // Default exitToNormal handler restores NORMAL mode
    keyHandler.on("exitToNormal", () => {
        keyHandler.setMode(Mode.NORMAL);
        const active = document.activeElement;
        if (active && active !== document.body) active.blur();
    });

    // Scroll and history navigation
    const scrollController = new ScrollController(keyHandler);

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

    // Expose for other modules (HintMode, FindMode, TabSearch, ScrollController)
    window.__vimiumKeyHandler = keyHandler;
})();
