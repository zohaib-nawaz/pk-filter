import type { Request, ResponseMap } from '../core/messages';
import { clearCache, countCache, readSync, requestRefresh } from '../shared/storage';
import { getServiceStatus } from './api-client';
import { checkDomains, lookupCached, resetBackoff } from './checker';
import { startDownload, watchDownloads } from './download-manager';
import { inspectMedia } from './media-inspector';
import { syncVideoSites } from './video-sites';

const SIMPLE_TYPES = ['overview', 'refresh', 'clear-cache', 'sync-video-sites'];

function isStringList(value: unknown, max: number): value is string[] {
  return Array.isArray(value) && value.length <= max && value.every((item) => typeof item === 'string');
}

function isRequest(value: unknown): value is Request {
  const message = value as { type?: unknown; domains?: unknown; url?: unknown; title?: unknown } | null;
  if (!message || typeof message.type !== 'string') return false;
  if (message.type === 'check' || message.type === 'lookup') return isStringList(message.domains, 100);
  if (message.type === 'inspect-media') return typeof message.url === 'string' && message.url.length <= 4096;
  if (message.type === 'download') {
    return typeof message.url === 'string' && message.url.length <= 4096 && typeof message.title === 'string';
  }
  return SIMPLE_TYPES.includes(message.type);
}

async function handle(request: Request): Promise<ResponseMap[Request['type']]> {
  switch (request.type) {
    case 'lookup':
      return { results: await lookupCached(request.domains) };
    case 'check':
      return { results: await checkDomains(request.domains) };
    case 'inspect-media':
      return inspectMedia(request.url);
    case 'download':
      return startDownload(request.url, request.title.slice(0, 300));
    case 'sync-video-sites':
      return { ok: await syncVideoSites() };
    case 'overview': {
      const [cachedDomains, sync, service] = await Promise.all([countCache(Date.now()), readSync(), getServiceStatus()]);
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

function syncDownloader(): void {
  watchDownloads();
  void syncVideoSites().catch(() => undefined);
}

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || !isRequest(message)) return false;
  handle(message)
    .then(sendResponse)
    .catch(() => sendResponse(null));
  return true;
});

chrome.permissions.onAdded.addListener(syncDownloader);
chrome.permissions.onRemoved.addListener(syncDownloader);
chrome.runtime.onStartup.addListener(syncDownloader);
chrome.runtime.onInstalled.addListener(syncDownloader);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes.settings) syncDownloader();
});
watchDownloads();
