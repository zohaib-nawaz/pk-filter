import type { Request, ResponseMap } from '../core/messages';
import { clearCache, countCache, readSync, requestRefresh } from '../shared/storage';
import { getServiceStatus } from './api-client';
import { checkDomains, resetBackoff } from './checker';

function isRequest(value: unknown): value is Request {
  const message = value as { type?: unknown; domains?: unknown } | null;
  if (!message || typeof message.type !== 'string') return false;
  if (message.type === 'check') {
    return Array.isArray(message.domains) && message.domains.length <= 100 && message.domains.every((d) => typeof d === 'string');
  }
  return ['overview', 'refresh', 'clear-cache'].includes(message.type);
}

async function handle(request: Request): Promise<ResponseMap[Request['type']]> {
  switch (request.type) {
    case 'check':
      return { results: await checkDomains(request.domains) };
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

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || !isRequest(message)) return false;
  handle(message)
    .then(sendResponse)
    .catch(() => sendResponse(null));
  return true;
});
