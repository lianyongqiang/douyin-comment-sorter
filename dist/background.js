// src/background/service-worker.ts
var ACTIVATE_MESSAGE = { type: "DCS_ACTIVATE_TOOLBAR" };
function isDouyinUrl(url) {
  if (!url) return false;
  try {
    return new URL(url).hostname === "www.douyin.com";
  } catch {
    return false;
  }
}
async function injectContentAssets(tabId) {
  const manifest = chrome.runtime.getManifest();
  const contentScript = manifest.content_scripts?.find(
    (entry) => entry.matches?.some((pattern) => pattern.includes("douyin.com"))
  );
  if (!contentScript?.js?.length) {
    throw new Error("\u672A\u627E\u5230\u8BC4\u8BBA\u8BFB\u53D6\u7A0B\u5E8F\u3002");
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
async function activateToolbar(tab) {
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
