import { createLimiter } from '../core/limiter';
import { classifyMediaResponse, describeSource, safeHttpUrl, sourceKind } from '../core/media';
import type { MediaInfo } from '../core/types';
import { hasDownloaderPermissions } from '../shared/permissions';

interface CachedInfo {
  info: MediaInfo;
  expiresAt: number;
}

const OK_TTL_MS = 10 * 60_000;
const FAILURE_TTL_MS = 2 * 60_000;
const MAX_CACHE = 300;
const TIMEOUT_MS = 10_000;
const cache = new Map<string, CachedInfo>();
const limit = createLimiter(3);

function remember(key: string, info: MediaInfo): MediaInfo {
  cache.delete(key);
  cache.set(key, { info, expiresAt: Date.now() + (info.status === 'downloadable' ? OK_TTL_MS : FAILURE_TTL_MS) });
  if (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value as string);
  return info;
}

async function probe(url: URL): Promise<Response> {
  const init: RequestInit = { credentials: 'include', redirect: 'follow', cache: 'no-store' };
  const head = await fetch(url, { ...init, method: 'HEAD', signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (head.ok && head.headers.get('content-type')) return head;
  if (head.status !== 405 && head.status !== 501 && !head.ok) return head;
  const ranged = await fetch(url, { ...init, method: 'GET', headers: { range: 'bytes=0-0' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  await ranged.body?.cancel().catch(() => undefined);
  return ranged;
}

function unsupported(url: string, status: MediaInfo['status'], reason: string): MediaInfo {
  return { status, url, extension: null, mime: null, sizeBytes: null, reason };
}

export async function inspectMedia(raw: string): Promise<MediaInfo> {
  const kind = sourceKind(raw);
  if (kind === 'blob' || kind === 'streaming') return unsupported(raw, 'streaming', describeSource(kind));
  const url = safeHttpUrl(raw);
  if (!url) return unsupported(raw, 'unsupported', 'Invalid or unsafe video address');
  const key = url.toString();
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.info;
  if (!(await hasDownloaderPermissions())) {
    return unsupported(key, 'unsupported', 'Turn on the video downloader in the extension settings');
  }
  try {
    const response = await limit(() => probe(url));
    return remember(
      key,
      classifyMediaResponse({
        status: response.status,
        url: response.url || key,
        contentType: response.headers.get('content-type'),
        contentLength: response.headers.get('content-length'),
        contentRange: response.headers.get('content-range'),
      }),
    );
  } catch (error) {
    const timedOut = error instanceof DOMException && error.name === 'TimeoutError';
    return remember(key, unsupported(key, 'unavailable', timedOut ? 'The video server did not respond' : 'Could not reach the video server'));
  }
}
