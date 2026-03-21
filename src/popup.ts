declare const browser: {
  runtime: { getURL(path: string): string };
  tabs: { create(options: { url: string }): Promise<unknown> };
};

browser.tabs.create({ url: browser.runtime.getURL("settings.html") });
window.close();
