import { fetchOEmbed, readText, readUrl, type OEmbedData } from './oembed.js';
import { openSafe } from './safe-http.js';
import { MediaUnavailable, type MediaInspection } from './types.js';
import { platformOf } from './video-links.js';

const OEMBED_URL = 'https://www.tiktok.com/oembed';
const PLAYER_URL = 'https://www.tiktok.com/player/v1/';
const VIDEO_ID = /\/(?:video|photo|v)\/(\d{6,25})/;
const NUMERIC_ID = /^\d{6,25}$/;
const HANDLE = /^\/@([\w.]{2,32})(?:\/|$)/;

export function isTikTokUrl(url: URL): boolean {
  return platformOf(url) === 'tiktok';
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

function notFound(): MediaUnavailable {
  return new MediaUnavailable('not_found', 'This TikTok video could not be found. It may be private or removed.');
}

function videoIdOf(data: OEmbedData, url: string): string | null {
  const fromEmbed = readText(data.embed_product_id);
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
  const data = await fetchOEmbed(`${OEMBED_URL}?url=${encodeURIComponent(canonical)}`, notFound);
  const videoId = videoIdOf(data, canonical);
  const handle = handleOf(canonical);
  if (!videoId) {
    throw new MediaUnavailable('not_found', 'This TikTok link does not point to a video.');
  }
  return {
    title: readText(data.title) || (handle ? `TikTok video by ${handle.author}` : 'TikTok video'),
    source: 'tiktok',
    durationSeconds: null,
    thumbnail: readUrl(data.thumbnail_url),
    embed: {
      provider: 'tiktok',
      playerUrl: `${PLAYER_URL}${videoId}`,
      openUrl: canonical,
      author: readText(data.author_name) || (handle ? handle.author : null),
      authorUrl: readUrl(data.author_url) || (handle ? handle.authorUrl : null),
    },
    formats: [],
  };
}
