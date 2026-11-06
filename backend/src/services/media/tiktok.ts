import { fetchText, MediaFetchError, openSafe } from './safe-http.js';
import { MediaUnavailable, type MediaInspection } from './types.js';

const OEMBED_URL = 'https://www.tiktok.com/oembed';
const PLAYER_URL = 'https://www.tiktok.com/player/v1/';
const OEMBED_LIMIT = 256 * 1024;
const VIDEO_ID = /\/(?:video|photo|v)\/(\d{6,25})/;
const NUMERIC_ID = /^\d{6,25}$/;
const HANDLE = /^\/@([\w.]{2,32})(?:\/|$)/;

interface OEmbed {
  title?: unknown;
  author_name?: unknown;
  author_url?: unknown;
  thumbnail_url?: unknown;
  embed_product_id?: unknown;
}

export function isTikTokUrl(url: URL): boolean {
  const host = url.hostname.toLowerCase();
  return host === 'tiktok.com' || host.endsWith('.tiktok.com');
}

function text(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }
  return value.trim();
}

function httpUrl(value: unknown): string | null {
  const raw = text(value);
  if (!raw) {
    return null;
  }
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}

async function canonicalUrl(url: string): Promise<string> {
  if (VIDEO_ID.test(new URL(url).pathname)) {
    return url;
  }
  try {
    const response = await openSafe(url, { timeoutMs: 10_000 });
    response.body.destroy();
    return response.finalUrl;
  } catch {
    return url;
  }
}

async function oEmbed(url: string): Promise<OEmbed> {
  try {
    const { text: body } = await fetchText(`${OEMBED_URL}?url=${encodeURIComponent(url)}`, OEMBED_LIMIT);
    const parsed: unknown = JSON.parse(body);
    if (!parsed || typeof parsed !== 'object') {
      throw new Error('empty');
    }
    return parsed as OEmbed;
  } catch (error) {
    if (error instanceof MediaFetchError && error.failure !== 'http_error') {
      throw error;
    }
    throw new MediaUnavailable('not_found', 'This TikTok video could not be found. It may be private or removed.');
  }
}

function videoIdOf(data: OEmbed, url: string): string | null {
  const fromEmbed = text(data.embed_product_id);
  if (fromEmbed && NUMERIC_ID.test(fromEmbed)) {
    return fromEmbed;
  }
  const match = VIDEO_ID.exec(new URL(url).pathname);
  return match ? (match[1] as string) : null;
}

function handleOf(url: string): { author: string; authorUrl: string } | null {
  const match = HANDLE.exec(new URL(url).pathname);
  if (!match) {
    return null;
  }
  const handle = match[1] as string;
  return { author: `@${handle}`, authorUrl: `https://www.tiktok.com/@${handle}` };
}

export async function tiktokInspection(url: string): Promise<MediaInspection> {
  const canonical = await canonicalUrl(url);
  const data = await oEmbed(canonical);
  const videoId = videoIdOf(data, canonical);
  const handle = handleOf(canonical);
  if (!videoId) {
    throw new MediaUnavailable('not_found', 'This TikTok link does not point to a video.');
  }
  return {
    title: text(data.title) || (handle ? `TikTok video by ${handle.author}` : 'TikTok video'),
    source: 'tiktok',
    durationSeconds: null,
    thumbnail: httpUrl(data.thumbnail_url),
    embed: {
      provider: 'tiktok',
      playerUrl: `${PLAYER_URL}${videoId}`,
      openUrl: canonical,
      author: text(data.author_name) || (handle ? handle.author : null),
      authorUrl: httpUrl(data.author_url) || (handle ? handle.authorUrl : null),
    },
    formats: [],
  };
}
