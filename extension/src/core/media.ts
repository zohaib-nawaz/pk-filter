import type { MediaInfo } from './types';

const MEDIA_TYPES: Record<string, string> = {
  mp4: 'video/mp4',
  m4v: 'video/x-m4v',
  webm: 'video/webm',
  mov: 'video/quicktime',
  ogv: 'video/ogg',
  mkv: 'video/x-matroska',
  avi: 'video/x-msvideo',
  flv: 'video/x-flv',
  '3gp': 'video/3gpp',
  mpeg: 'video/mpeg',
  mpg: 'video/mpeg',
  ts: 'video/mp2t',
  wmv: 'video/x-ms-wmv',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/opus',
  wav: 'audio/wav',
  flac: 'audio/flac',
  weba: 'audio/webm',
};

const MIME_ALIASES: Record<string, string> = {
  'video/avi': 'avi',
  'video/msvideo': 'avi',
  'video/x-ms-asf': 'wmv',
  'audio/mp3': 'mp3',
  'audio/x-mp3': 'mp3',
  'audio/m4a': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/x-aac': 'aac',
  'audio/x-wav': 'wav',
  'audio/wave': 'wav',
  'audio/vnd.wave': 'wav',
  'audio/x-flac': 'flac',
};

const MIME_EXTENSIONS: Record<string, string> = Object.entries(MEDIA_TYPES).reduce<Record<string, string>>(
  (map, [extension, mime]) => (map[mime] ? map : { ...map, [mime]: extension }),
  { ...MIME_ALIASES },
);

export const MEDIA_LINK_EXTENSIONS = Object.keys(MEDIA_TYPES).filter((extension) => extension !== 'ts');

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
  return mime ? (MIME_EXTENSIONS[mime] ?? null) : null;
}

export function isMediaExtension(extension: string | null): boolean {
  return extension !== null && extension in MEDIA_TYPES;
}

export function sourceKind(raw: string | null | undefined, base?: string): SourceKind {
  if (!raw) return 'invalid';
  if (raw.startsWith('blob:') || raw.startsWith('mediasource:')) return 'blob';
  const url = safeHttpUrl(raw, base);
  if (!url) return 'invalid';
  const extension = extensionFromPath(url);
  if (extension && STREAMING_EXTENSIONS.has(extension)) return 'streaming';
  return isMediaExtension(extension) ? 'direct' : 'unknown';
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
  sniffed?: string | null;
}

export const SNIFF_BYTES = 192;

function text(bytes: Uint8Array, start: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(start, start + length));
}

function startsWith(bytes: Uint8Array, signature: number[]): boolean {
  return signature.every((value, index) => bytes[index] === value);
}

function sniffMpegAudio(bytes: Uint8Array): string | null {
  if (text(bytes, 0, 3) === 'ID3') return 'audio/mpeg';
  if (bytes[0] !== 0xff || bytes.length < 2) return null;
  const second = bytes[1] as number;
  if ((second & 0xf6) === 0xf0) return 'audio/aac';
  if ((second & 0xe0) === 0xe0 && ((second >> 1) & 0x03) !== 0) return 'audio/mpeg';
  return null;
}

export function sniffMediaType(bytes: Uint8Array): string | null {
  if (bytes.length >= 12 && text(bytes, 4, 4) === 'ftyp') {
    const brand = text(bytes, 8, 4);
    if (brand === 'M4A ' || brand === 'M4B ') return 'audio/mp4';
    if (brand === 'qt  ') return 'video/quicktime';
    if (brand.startsWith('3g')) return 'video/3gpp';
    return 'video/mp4';
  }
  if (startsWith(bytes, [0x1a, 0x45, 0xdf, 0xa3])) return text(bytes, 0, 64).includes('webm') ? 'video/webm' : 'video/x-matroska';
  if (text(bytes, 0, 4) === 'OggS') return 'audio/ogg';
  if (text(bytes, 0, 4) === 'fLaC') return 'audio/flac';
  if (text(bytes, 0, 3) === 'FLV') return 'video/x-flv';
  if (text(bytes, 0, 4) === 'RIFF' && text(bytes, 8, 4) === 'WAVE') return 'audio/wav';
  if (text(bytes, 0, 4) === 'RIFF' && text(bytes, 8, 4) === 'AVI ') return 'video/x-msvideo';
  if (startsWith(bytes, [0x30, 0x26, 0xb2, 0x75, 0x8e, 0x66, 0xcf, 0x11])) return 'video/x-ms-wmv';
  if (startsWith(bytes, [0x00, 0x00, 0x01, 0xba])) return 'video/mpeg';
  if (bytes[0] === 0x47 && bytes.length > 188 && bytes[188] === 0x47) return 'video/mp2t';
  return sniffMpegAudio(bytes);
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

  const declared = response.contentType?.split(';')[0]?.trim().toLowerCase() ?? null;
  const declaredIsMedia = declared !== null && (declared.startsWith('video/') || declared.startsWith('audio/') || STREAMING_MIMES.includes(declared));
  const mime = declaredIsMedia ? declared : (response.sniffed ?? declared);
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
    reason: 'Direct media file',
  });
  if (mime?.startsWith('video/') || mime?.startsWith('audio/')) {
    const extension = extensionFromMime(mime);
    return extension ? downloadable(extension) : { ...base, mime, status: 'unsupported', reason: `Unsupported media format (${mime})` };
  }
  if (mime !== null && GENERIC_BINARY.includes(mime) && isMediaExtension(pathExtension)) return downloadable(pathExtension as string);
  return { ...base, mime, status: 'unsupported', reason: 'This link is not a video or audio file' };
}

export function describeSource(kind: SourceKind): string {
  if (kind === 'blob') return 'This media is streamed in pieces by the page and has no single file to download';
  if (kind === 'streaming') return 'Streaming playlist (HLS/DASH) is not supported';
  return 'No downloadable media source found';
}
