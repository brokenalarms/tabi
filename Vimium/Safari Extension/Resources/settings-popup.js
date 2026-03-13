// Settings popup — reads/writes browser.storage.local.
// Content scripts pick up changes live via browser.storage.onChanged.

function initSegmented(id, storageKey) {
  const container = document.getElementById(id);
  if (!container) return;
  const buttons = container.querySelectorAll("button[data-value]");

  browser.storage.local.get(storageKey).then((result) => {
    const value = result[storageKey];
    if (value === undefined) return;
    buttons.forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.value === value);
    });
  });

  buttons.forEach((btn) => {
    btn.addEventListener("click", () => {
      buttons.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      browser.storage.local.set({ [storageKey]: btn.dataset.value });
    });
  });
}

initSegmented("keyBindingMode", "keyBindingMode");
initSegmented("theme", "theme");
