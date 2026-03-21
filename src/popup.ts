declare const browser: {
  runtime: { getURL(path: string): string };
  tabs: {
    create(options: { url: string; active: boolean }): Promise<unknown>;
    query(query: { url: string }): Promise<{ id?: number }[]>;
    update(tabId: number, options: { active: boolean }): Promise<unknown>;
  };
};

const settingsUrl = browser.runtime.getURL("settings.html");

browser.tabs.query({ url: settingsUrl }).then((tabs) => {
  if (tabs.length > 0 && tabs[0].id !== undefined) {
    browser.tabs.update(tabs[0].id, { active: true });
  } else {
    browser.tabs.create({ url: settingsUrl, active: true });
  }
  window.close();
});
