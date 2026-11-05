import { createLimiter } from '../core/limiter';
import { classifyMediaResponse, describeSource, safeHttpUrl, SNIFF_BYTES, sniffMediaType, sourceKind } from '../core/media';
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
  if (cache.size > MAX_CACHE) {
    cache.delete(cache.keys().next().value as string);
  }
  return info;
}

interface Probe {
  response: Response;
  sniffed: string | null;
}

const GONE = new Set([404, 410]);

function declaresMedia(response: Response): boolean {
  const type = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() ?? '';
  return type.startsWith('video/') || type.startsWith('audio/') || type.includes('mpegurl') || type === 'application/dash+xml';
}

async function readStart(response: Response): Promise<Uint8Array> {
  const reader = response.body?.getReader();
  if (!reader) {
    return new Uint8Array();
  }
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (length < SNIFF_BYTES) {
    const { done, value } = await reader.read();
    if (done || !value) {
      break;
    }
    chunks.push(value);
    length += value.byteLength;
  }
  await reader.cancel().catch(() => undefined);
  const out = new Uint8Array(Math.min(length, SNIFF_BYTES));
  let offset = 0;
  for (const chunk of chunks) {
    const part = chunk.subarray(0, out.length - offset);
    out.set(part, offset);
    offset += part.length;
    if (offset >= out.length) {
      break;
    }
  }
  return out;
}

async function probe(url: URL): Promise<Probe> {
  const init: RequestInit = { credentials: 'include', redirect: 'follow', cache: 'no-store' };
  const head = await fetch(url, { ...init, method: 'HEAD', signal: AbortSignal.timeout(TIMEOUT_MS) }).catch(() => null);
  if (head && head.ok && declaresMedia(head)) {
    return { response: head, sniffed: null };
  }
  if (head && GONE.has(head.status)) {
    return { response: head, sniffed: null };
  }
  try {
    const ranged = await fetch(url, {
      ...init,
      method: 'GET',
      headers: { range: `bytes=0-${SNIFF_BYTES - 1}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const sniffed = ranged.ok ? sniffMediaType(await readStart(ranged)) : null;
    if (!ranged.ok) {
      await ranged.body?.cancel().catch(() => undefined);
    }
    return { response: ranged, sniffed };
  } catch (error) {
    if (head) {
      return { response: head, sniffed: null };
    }
    throw error;
  }
}

function unsupported(url: string, status: MediaInfo['status'], reason: string): MediaInfo {
  return { status, url, extension: null, mime: null, sizeBytes: null, reason };
}

export async function inspectMedia(raw: string): Promise<MediaInfo> {
  const kind = sourceKind(raw);
  if (kind === 'blob' || kind === 'streaming') {
    return unsupported(raw, 'streaming', describeSource(kind));
  }
  const url = safeHttpUrl(raw);
  if (!url) {
    return unsupported(raw, 'unsupported', 'Invalid or unsafe video address');
  }
  const key = url.toString();
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.info;
  }
  if (!(await hasDownloaderPermissions())) {
    return unsupported(key, 'unsupported', 'Turn on the video downloader in the extension settings');
  }
  try {
    const { response, sniffed } = await limit(() => probe(url));
    return remember(
      key,
      classifyMediaResponse({
        status: response.status,
        url: response.url || key,
        contentType: response.headers.get('content-type'),
        contentLength: response.headers.get('content-length'),
        contentRange: response.headers.get('content-range'),
        sniffed,
      }),
    );
  } catch (error) {
    const timedOut = error instanceof DOMException && error.name === 'TimeoutError';
    return remember(key, unsupported(key, 'unavailable', timedOut ? 'The video server did not respond' : 'Could not reach the video server'));
  }
}
