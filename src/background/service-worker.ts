const ACTIVATE_MESSAGE = { type: "DCS_ACTIVATE_TOOLBAR" } as const;

function isDouyinUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    return new URL(url).hostname === "www.douyin.com";
  } catch {
    return false;
  }
}

async function injectContentAssets(tabId: number): Promise<void> {
  const manifest = chrome.runtime.getManifest();
  const contentScript = manifest.content_scripts?.find((entry) =>
    entry.matches?.some((pattern) => pattern.includes("douyin.com"))
  );
  if (!contentScript?.js?.length) {
    throw new Error("未找到评论读取程序。");
  }

  if (contentScript.css?.length) {
    await chrome.scripting.insertCSS({
      target: { tabId },
      files: contentScript.css
    });
  }
  await chrome.scripting.executeScript({
    target: { tabId },
    files: contentScript.js
  });
}

async function activateToolbar(tab: chrome.tabs.Tab): Promise<void> {
  if (!tab.id || !isDouyinUrl(tab.url)) return;
  try {
    await chrome.tabs.sendMessage(tab.id, ACTIVATE_MESSAGE);
  } catch {
    await injectContentAssets(tab.id);
    await chrome.tabs.sendMessage(tab.id, ACTIVATE_MESSAGE);
  }
}

chrome.action.onClicked.addListener((tab) => {
  void activateToolbar(tab);
});
