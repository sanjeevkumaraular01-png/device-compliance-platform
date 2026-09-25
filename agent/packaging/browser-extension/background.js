// SecureEndpoint Activity - reports ONLY the hostname of the active tab to the
// local agent (native messaging host "com.secureendpoint.agent"). The agent
// decides whether it is inside tracked work hours; outside them the value is
// ignored. No path, query, title, page content or keystrokes are ever read.

const HOST = "com.secureendpoint.agent";
const BROWSER = navigator.userAgent.includes("Edg/") ? "edge" : "chrome";
let port = null;
let lastSent = "";

function connect() {
  try {
    port = chrome.runtime.connectNative(HOST);
    port.onDisconnect.addListener(() => {
      port = null; // agent not installed or restarted; retry on next change
    });
  } catch (_) {
    port = null;
  }
}

function hostnameOf(url) {
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:" ? u.hostname : "";
  } catch (_) {
    return "";
  }
}

function report(url) {
  const host = hostnameOf(url || "");
  if (host === lastSent) return;
  lastSent = host;
  if (!port) connect();
  try {
    port && port.postMessage({ host, browser: BROWSER });
  } catch (_) {
    port = null;
  }
}

async function reportActive() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  report(tab ? tab.url : "");
}

chrome.tabs.onActivated.addListener(reportActive);
chrome.tabs.onUpdated.addListener((_id, change, tab) => {
  if (change.url && tab.active) report(tab.url);
});
chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) report("");
  else reportActive();
});
// Re-send every 30 s so the agent knows the tab is still active (it treats
// reports older than 2 minutes as stale, e.g. after the browser closed).
chrome.alarms.create("sem-refresh", { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener(() => {
  lastSent = "";
  reportActive();
});
reportActive();
