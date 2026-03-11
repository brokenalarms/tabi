// Vimium background service worker
// Handles tab management and messaging with content scripts

browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log("Vimium background: received message", message);
    sendResponse({ status: "ok" });
});
