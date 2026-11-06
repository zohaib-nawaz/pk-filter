import { normalizeDomain } from '../core/domain';
import type { Request, ResponseMap } from '../core/messages';
import { sanitizeSettings } from '../core/settings';
import { removeDownloadRecord } from '../shared/download-store';
import { clearCache, countCache, readSync, requestRefresh, writeSync } from '../shared/storage';
import { getHistory, getServiceStatus } from './api-client';
import { checkDomains, lookupCached, resetBackoff } from './checker';
import { createContextMenus, watchContextMenus } from './context-menu';
import { watchDownloads } from './download-manager';
import { watchFilenames } from './download-names';
import { inspectAny, startAny } from './download-router';
import { watchFailedSites } from './failed-sites';
import { rescheduleNightQueue, scheduleDownload, unscheduleDownload, watchNightQueue } from './night-queue';
import { getPageVideos, setPageVideos, watchTabs } from './page-videos';
import { controlStreamJob, failInterruptedJobs, handleOffscreenEvent, watchStreamDownloads } from './stream-jobs';
import { syncVideoSites } from './video-sites';
import { currentViewer } from './viewer';

const ADMIN_TYPES = ['overview', 'refresh', 'clear-cache', 'sync-video-sites'];
const OFFSCREEN_EVENTS = ['stream-progress', 'stream-track-ready', 'stream-failed', 'stream-split'];
const STREAM_ACTIONS = ['pause', 'resume', 'cancel', 'retry', 'remove'];

function isStringList(value: unknown, max: number): value is string[] {
  return Array.isArray(value) && value.length <= max && value.every((item) => typeof item === 'string');
}

function isPageVideo(value: unknown): boolean {
  const video = value as Record<string, unknown> | null;
  return (
    !!video &&
    typeof video.url === 'string' &&
    video.url.length <= 4096 &&
    typeof video.title === 'string' &&
    typeof video.extension === 'string' &&
    (video.sizeBytes === null || typeof video.sizeBytes === 'number') &&
    (video.separateAudio === undefined || typeof video.separateAudio === 'boolean')
  );
}

const MAX_HEIGHT = 8640;

function isHeight(value: unknown): boolean {
  return value === undefined || (typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= MAX_HEIGHT);
}

function isDownloadRequest(message: Record<string, unknown>): boolean {
  return (
    typeof message.url === 'string' &&
    message.url.length <= 4096 &&
    typeof message.title === 'string' &&
    (message.pageUrl === undefined || typeof message.pageUrl === 'string') &&
    (message.audioOnly === undefined || typeof message.audioOnly === 'boolean') &&
    isHeight(message.maxHeight)
  );
}

function pageUrlFor(sender: chrome.runtime.MessageSender, claimed: string | undefined): string | undefined {
  if (sender.tab) {
    return sender.tab.url;
  }
  return claimed;
}

function fromExtensionPage(sender: chrome.runtime.MessageSender): boolean {
  return typeof sender.url === 'string' && sender.url.startsWith(chrome.runtime.getURL(''));
}

function isRequest(value: unknown, sender: chrome.runtime.MessageSender): value is Request {
  const message = value as {
    type?: unknown;
    domains?: unknown;
    url?: unknown;
    title?: unknown;
    videos?: unknown;
    tabId?: unknown;
    id?: unknown;
    action?: unknown;
  } | null;
  if (!message || typeof message.type !== 'string') {
    return false;
  }
  if (OFFSCREEN_EVENTS.includes(message.type)) {
    return sender.url === chrome.runtime.getURL('offscreen.html') && typeof message.id === 'string';
  }
  if (message.type === 'stream-control') {
    return fromExtensionPage(sender) && typeof message.id === 'string' && STREAM_ACTIONS.includes(message.action as string);
  }
  if (message.type === 'remove-download') {
    return fromExtensionPage(sender) && Number.isInteger(message.id);
  }
  if (message.type === 'check' || message.type === 'lookup') {
    return isStringList(message.domains, 100);
  }
  if (message.type === 'inspect-media') {
    return typeof message.url === 'string' && message.url.length <= 4096;
  }
  if (message.type === 'download') {
    return isDownloadRequest(message as Record<string, unknown>);
  }
  if (message.type === 'schedule-download') {
    return fromExtensionPage(sender) && isDownloadRequest(message as Record<string, unknown>);
  }
  if (message.type === 'unschedule-download') {
    return fromExtensionPage(sender) && typeof message.id === 'string';
  }
  if (message.type === 'page-videos') {
    return Array.isArray(message.videos) && message.videos.length <= 50 && message.videos.every(isPageVideo);
  }
  if (message.type === 'site-status') {
    return typeof (message as { domain?: unknown }).domain === 'string';
  }
  if (message.type === 'tab-videos') {
    return fromExtensionPage(sender) && Number.isInteger(message.tabId);
  }
  return ADMIN_TYPES.includes(message.type) && fromExtensionPage(sender);
}

async function handle(request: Request, sender: chrome.runtime.MessageSender): Promise<ResponseMap[Request['type']]> {
  const tabId = sender.tab?.id;
  switch (request.type) {
    case 'stream-progress':
    case 'stream-track-ready':
    case 'stream-failed':
    case 'stream-split':
      await handleOffscreenEvent(request);
      return { ok: true };
    case 'stream-control':
      return controlStreamJob(request.id, request.action);
    case 'remove-download':
      await removeDownloadRecord(request.id);
      return { ok: true };
    case 'page-videos':
      if (tabId === undefined) {
        return { ok: false };
      }
      await setPageVideos(tabId, request.videos);
      return { ok: true };
    case 'tab-videos':
      return { videos: await getPageVideos(request.tabId) };
    case 'lookup':
      return { results: await lookupCached(request.domains) };
    case 'check':
      return { results: await checkDomains(request.domains) };
    case 'site-status': {
      const domain = normalizeDomain(request.domain);
      if (!domain) {
        return { domain: request.domain, result: null, history: null };
      }
      const { country } = await currentViewer();
      const [results, history] = await Promise.all([checkDomains([domain]), getHistory(domain, country)]);
      const result = results[domain];
      return { domain, result: result ? result : null, history };
    }
    case 'inspect-media':
      return inspectAny(request.url, pageUrlFor(sender, undefined));
    case 'download':
      return startAny(request.url, request.title, pageUrlFor(sender, request.pageUrl), { audioOnly: request.audioOnly === true, maxHeight: request.maxHeight });
    case 'schedule-download':
      return scheduleDownload({
        url: request.url,
        title: request.title.slice(0, 300),
        pageUrl: request.pageUrl === undefined ? null : request.pageUrl,
        audioOnly: request.audioOnly === true,
      });
    case 'unschedule-download':
      await unscheduleDownload(request.id);
      return { ok: true };
    case 'sync-video-sites':
      return { ok: await syncVideoSites() };
    case 'overview': {
      const [cachedDomains, sync, service, viewer] = await Promise.all([countCache(Date.now()), readSync(), getServiceStatus(), currentViewer()]);
      if (service.online && sync.lastError) {
        resetBackoff();
        await writeSync({ lastError: null });
        return { cachedDomains, sync: { ...sync, lastError: null }, service, viewer };
      }
      return { cachedDomains, sync, service, viewer };
    }
    case 'refresh':
      await clearCache();
      resetBackoff();
      await requestRefresh();
      return { ok: true };
    case 'clear-cache':
      await clearCache();
      return { ok: true };
  }
}

function localCheckChanged(change: chrome.storage.StorageChange): boolean {
  const before = sanitizeSettings(change.oldValue);
  const after = sanitizeSettings(change.newValue);
  return before.localCheck !== after.localCheck;
}

function syncDownloader(reinject = false): void {
  watchDownloads();
  watchStreamDownloads();
  void syncVideoSites(reinject).catch(() => undefined);
}

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || !isRequest(message, sender)) {
    return false;
  }
  handle(message, sender)
    .then(sendResponse)
    .catch(() => sendResponse(null));
  return true;
});

chrome.permissions.onAdded.addListener(() => syncDownloader());
chrome.permissions.onRemoved.addListener(() => syncDownloader());
chrome.runtime.onStartup.addListener(() => {
  createContextMenus();
  syncDownloader();
});
chrome.runtime.onInstalled.addListener(() => {
  createContextMenus();
  syncDownloader(true);
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes.settings) {
    syncDownloader();
    rescheduleNightQueue();
    void currentViewer().catch(() => undefined);
    if (localCheckChanged(changes.settings)) {
      void requestRefresh();
    }
  }
});
chrome.permissions.onAdded.addListener(() => watchFailedSites());
watchFilenames();
watchDownloads();
watchStreamDownloads();
watchTabs();
watchContextMenus();
watchFailedSites();
watchNightQueue(startAny);
void failInterruptedJobs().catch(() => undefined);
