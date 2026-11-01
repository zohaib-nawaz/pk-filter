import type { MediaInfo } from './types';

const VIDEO_TYPES: Record<string, string> = {
  mp4: 'video/mp4',
  m4v: 'video/x-m4v',
  webm: 'video/webm',
  mov: 'video/quicktime',
  ogv: 'video/ogg',
};

const STREAMING_EXTENSIONS = new Set(['m3u8', 'mpd', 'ism', 'f4m']);
const STREAMING_MIMES = ['application/vnd.apple.mpegurl', 'application/x-mpegurl', 'audio/mpegurl', 'application/dash+xml'];
const GENERIC_BINARY = ['application/octet-stream', 'binary/octet-stream', 'application/force-download'];
const BLOCKED_HOST_SUFFIXES = ['localhost', 'local', 'internal', 'intranet', 'lan', 'home', 'home.arpa', 'corp'];
const STREAMING_PLATFORMS = new Set([
  'youtube.com',
  'youtu.be',
  'vimeo.com',
  'dailymotion.com',
  'tiktok.com',
  'twitch.tv',
  'netflix.com',
]);
const DURATION = /^\d{1,2}:\d{2}(?::\d{2})?$/;

export type SourceKind = 'direct' | 'streaming' | 'blob' | 'unknown' | 'invalid';

function isPrivateIpv4(host: string): boolean {
  const parts = host.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b] = parts as [number, number];
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19))
  );
}

function isBlockedHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  if (host.startsWith('[') || host.includes(':')) return true;
  if (/^[\d.]+$/.test(host)) return isPrivateIpv4(host) || host.split('.').length !== 4;
  if (!host.includes('.')) return true;
  return BLOCKED_HOST_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
}

export function safeHttpUrl(raw: string | null | undefined, base?: string): URL | null {
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw, base);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.username || url.password || isBlockedHost(url.hostname)) return null;
  return url;
}

export function extensionFromPath(url: URL): string | null {
  const match = /\.([a-z0-9]{2,5})$/i.exec(url.pathname);
  return match?.[1]?.toLowerCase() ?? null;
}

export function extensionFromMime(mime: string | null): string | null {
  if (!mime) return null;
  const entry = Object.entries(VIDEO_TYPES).find(([, type]) => type === mime);
  return entry?.[0] ?? null;
}

export function isVideoExtension(extension: string | null): boolean {
  return extension !== null && extension in VIDEO_TYPES;
}

export function sourceKind(raw: string | null | undefined, base?: string): SourceKind {
  if (!raw) return 'invalid';
  if (raw.startsWith('blob:') || raw.startsWith('mediasource:')) return 'blob';
  const url = safeHttpUrl(raw, base);
  if (!url) return 'invalid';
  const extension = extensionFromPath(url);
  if (extension && STREAMING_EXTENSIONS.has(extension)) return 'streaming';
  return isVideoExtension(extension) ? 'direct' : 'unknown';
}

export function isStreamingPlatform(domain: string): boolean {
  return STREAMING_PLATFORMS.has(domain);
}

export function looksLikeDuration(text: string | null | undefined): boolean {
  return DURATION.test(text?.trim() ?? '');
}

function parseSize(contentLength: string | null, contentRange: string | null): number | null {
  const total = /\/(\d+)$/.exec(contentRange ?? '')?.[1];
  const value = Number(total ?? contentLength);
  return Number.isFinite(value) && value > 1 ? value : null;
}

export interface MediaResponse {
  status: number;
  url: string;
  contentType: string | null;
  contentLength: string | null;
  contentRange: string | null;
}

const UNAVAILABLE: Record<number, string> = {
  401: 'This video needs you to sign in on the website',
  403: 'Access denied or the link has expired',
  404: 'Video not found',
  410: 'Video was removed',
};

export function classifyMediaResponse(response: MediaResponse): MediaInfo {
  const finalUrl = safeHttpUrl(response.url);
  const base = { url: response.url, extension: null, mime: null, sizeBytes: null };
  if (!finalUrl) return { ...base, status: 'unsupported', reason: 'Redirected to an unsafe address' };
  if (UNAVAILABLE[response.status]) return { ...base, status: 'unavailable', reason: UNAVAILABLE[response.status] as string };
  if (response.status >= 500) return { ...base, status: 'unavailable', reason: 'The video server returned an error' };
  if (response.status >= 400 || response.status < 200) return { ...base, status: 'unavailable', reason: `Video server answered ${response.status}` };

  const mime = response.contentType?.split(';')[0]?.trim().toLowerCase() ?? null;
  const pathExtension = extensionFromPath(finalUrl);
  const sizeBytes = parseSize(response.contentLength, response.contentRange);
  if (mime && STREAMING_MIMES.includes(mime)) {
    return { ...base, mime, status: 'streaming', reason: 'Streaming playlist (HLS/DASH) is not supported' };
  }
  const downloadable = (extension: string): MediaInfo => ({
    url: finalUrl.toString(),
    extension,
    mime,
    sizeBytes,
    status: 'downloadable',
    reason: 'Direct video file',
  });
  if (mime?.startsWith('video/')) {
    const extension = extensionFromMime(mime);
    return extension ? downloadable(extension) : { ...base, mime, status: 'unsupported', reason: `Unsupported video format (${mime})` };
  }
  if (mime !== null && GENERIC_BINARY.includes(mime) && isVideoExtension(pathExtension)) return downloadable(pathExtension as string);
  return { ...base, mime, status: 'unsupported', reason: 'This link is not a video file' };
}

export function describeSource(kind: SourceKind): string {
  if (kind === 'blob') return 'This video is streamed by the page and cannot be downloaded directly';
  if (kind === 'streaming') return 'Streaming playlist (HLS/DASH) is not supported';
  return 'No downloadable video source found';
}
