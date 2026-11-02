import { matchesStreamDomain } from '../core/hls';
import { extensionFromPath, safeHttpUrl } from '../core/media';
import type { Request, ResponseMap } from '../core/messages';
import { clearCache, countCache, loadSettings, readSync, requestRefresh, writeSync } from '../shared/storage';
import { getServiceStatus } from './api-client';
import { checkDomains, lookupCached, resetBackoff } from './checker';
import { startDownload, watchDownloads } from './download-manager';
import { inspectMedia } from './media-inspector';
import { getPageVideos, setPageVideos, watchTabs } from './page-videos';
import { inspectStream } from './stream-resolver';
import { controlStreamJob, failInterruptedJobs, handleOffscreenEvent, startStreamJob, watchStreamDownloads } from './stream-jobs';
import { syncVideoSites } from './video-sites';

const SIMPLE_TYPES = ['overview', 'refresh', 'clear-cache', 'sync-video-sites'];
const OFFSCREEN_EVENTS = ['stream-progress', 'stream-track-ready', 'stream-failed', 'stream-split'];
const STREAM_ACTIONS = ['pause', 'resume', 'cancel', 'retry', 'remove'];
const STREAM_EXTENSIONS = ['m3u8', 'mpd'];

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
    (video.sizeBytes === null || typeof video.sizeBytes === 'number')
  );
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
    return !sender.tab && typeof message.id === 'string' && STREAM_ACTIONS.includes(message.action as string);
  }
  if (message.type === 'check' || message.type === 'lookup') {
    return isStringList(message.domains, 100);
  }
  if (message.type === 'inspect-media') {
    return typeof message.url === 'string' && message.url.length <= 4096;
  }
  if (message.type === 'download') {
    const pageUrl = (message as { pageUrl?: unknown }).pageUrl;
    return (
      typeof message.url === 'string' &&
      message.url.length <= 4096 &&
      typeof message.title === 'string' &&
      (pageUrl === undefined || typeof pageUrl === 'string')
    );
  }
  if (message.type === 'page-videos') {
    return Array.isArray(message.videos) && message.videos.length <= 50 && message.videos.every(isPageVideo);
  }
  if (message.type === 'tab-videos') {
    return Number.isInteger(message.tabId);
  }
  return SIMPLE_TYPES.includes(message.type);
}

async function streamPage(url: string, sender: chrome.runtime.MessageSender, claimedPageUrl?: string): Promise<string | null> {
  const pageUrl = sender.tab ? sender.tab.url : claimedPageUrl;
  const target = safeHttpUrl(url);
  const page = safeHttpUrl(pageUrl);
  if (!target || !page || !STREAM_EXTENSIONS.includes(extensionFromPath(target) ?? '')) {
    return null;
  }
  const settings = await loadSettings();
  return settings.videoDownloader && matchesStreamDomain(page.hostname, settings.streamDomains) ? page.toString() : null;
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
    case 'inspect-media':
      return (await streamPage(request.url, sender)) ? inspectStream(request.url) : inspectMedia(request.url);
    case 'download': {
      const title = request.title.slice(0, 300);
      const page = await streamPage(request.url, sender, request.pageUrl);
      return page ? startStreamJob(request.url, title, page) : startDownload(request.url, title);
    }
    case 'sync-video-sites':
      return { ok: await syncVideoSites() };
    case 'overview': {
      const [cachedDomains, sync, service] = await Promise.all([countCache(Date.now()), readSync(), getServiceStatus()]);
      if (service.online && sync.lastError) {
        resetBackoff();
        await writeSync({ lastError: null });
        return { cachedDomains, sync: { ...sync, lastError: null }, service };
      }
      return { cachedDomains, sync, service };
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

function syncDownloader(reinject = false): void {
  watchDownloads();
  watchStreamDownloads();
watchTabs();
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
  void failInterruptedJobs();
  syncDownloader();
});
chrome.runtime.onInstalled.addListener(() => {
  void failInterruptedJobs();
  syncDownloader(true);
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes.settings) {
    syncDownloader();
  }
});
watchDownloads();
watchStreamDownloads();
watchTabs();
