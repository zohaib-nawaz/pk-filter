import { accessFailure } from '../core/net-errors';
import { domainFromUrl } from '../core/site-view';
import { siteReportQuery } from '../core/site-report';
import { loadSettings } from '../shared/storage';

let watching = false;
const shownFor = new Map<number, string>();

type ErrorDetails = chrome.webNavigation.WebNavigationFramedErrorCallbackDetails & { documentLifecycle?: string; frameType?: string };

function isVisibleTopFrame(details: ErrorDetails): boolean {
  if (details.frameId !== 0 || details.tabId < 0) {
    return false;
  }
  if (details.documentLifecycle === 'prerender') {
    return false;
  }
  return !details.frameType || details.frameType === 'outermost_frame';
}

function alreadyShown(tabId: number, url: string): boolean {
  return shownFor.get(tabId) === url;
}

function forgetAfterLeaving(details: chrome.webNavigation.WebNavigationTransitionCallbackDetails): void {
  const shown = shownFor.get(details.tabId);
  if (details.frameId !== 0 || !shown || details.url === shown || details.url.startsWith(chrome.runtime.getURL(''))) {
    return;
  }
  shownFor.delete(details.tabId);
}

async function explain(details: ErrorDetails): Promise<void> {
  if (!isVisibleTopFrame(details)) {
    return;
  }
  const code = accessFailure(details.error);
  const domain = domainFromUrl(details.url);
  if (!code || !domain) {
    return;
  }
  const settings = await loadSettings();
  if (!settings.enabled || !settings.explainFailures || alreadyShown(details.tabId, details.url)) {
    return;
  }
  const tab = await chrome.tabs.get(details.tabId);
  if (tab.incognito) {
    return;
  }
  shownFor.set(details.tabId, details.url);
  const page = chrome.runtime.getURL(siteReportQuery({ domain, mode: 'failed', url: details.url, error: code }));
  await chrome.tabs.update(details.tabId, { url: page });
}

export function watchFailedSites(): void {
  if (watching || !chrome.webNavigation) {
    return;
  }
  watching = true;
  chrome.webNavigation.onErrorOccurred.addListener((details) => void explain(details).catch(() => undefined));
  chrome.webNavigation.onCommitted.addListener(forgetAfterLeaving);
  chrome.tabs.onRemoved.addListener((tabId) => shownFor.delete(tabId));
}
