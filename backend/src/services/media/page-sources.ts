const MAX_CANDIDATES = 8;
const META = /<meta\b[^>]*>/gi;
const ATTRIBUTE = /([a-zA-Z_:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
const META_KEYS = new Set(['og:video', 'og:video:url', 'og:video:secure_url', 'og:audio', 'og:audio:url', 'twitter:player:stream']);
const TAGS = /<(video|source|audio|link|a)\b[^>]*>/gi;
const JSON_CONTENT_URL = /"contentUrl"\s*:\s*"([^"]+)"/gi;
const MEDIA_URL = /["'](https?:\\?\/\\?\/[^"'\s<>]+?\.(?:m3u8|mpd|mp4|webm|m4v|mov|mp3|m4a)(?:\?[^"'\s<>]*)?)["']/gi;
const TITLE = /<title[^>]*>([^<]*)<\/title>/i;
const ENTITIES: Record<string, string> = { '&amp;': '&', '&quot;': '"', '&#39;': "'", '&apos;': "'", '&lt;': '<', '&gt;': '>' };

function decode(value: string): string {
  return value
    .replace(/&(?:amp|quot|#39|apos|lt|gt);/g, (entity) => ENTITIES[entity] as string)
    .replace(/\\\//g, '/')
    .replace(/\\u0026/gi, '&')
    .trim();
}

function attributesOf(tag: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const match of tag.matchAll(ATTRIBUTE)) {
    const value = match[2] !== undefined ? match[2] : match[3];
    attrs[(match[1] as string).toLowerCase()] = decode(value === undefined ? '' : value);
  }
  return attrs;
}

function metaSources(html: string): string[] {
  const found: string[] = [];
  for (const match of html.matchAll(META)) {
    const attrs = attributesOf(match[0]);
    const key = (attrs.property || attrs.name || '').toLowerCase();
    if (META_KEYS.has(key) && attrs.content) {
      found.push(attrs.content);
    }
  }
  return found;
}

function tagSources(html: string): string[] {
  const found: string[] = [];
  for (const match of html.matchAll(TAGS)) {
    const tag = (match[1] as string).toLowerCase();
    const attrs = attributesOf(match[0]);
    if (attrs['data-download-url']) {
      found.push(attrs['data-download-url']);
    }
    if ((tag === 'video' || tag === 'source' || tag === 'audio') && attrs.src) {
      found.push(attrs.src);
    }
    if (tag === 'link' && (attrs.rel || '').toLowerCase() === 'alternate' && /^(video|audio)\//.test(attrs.type || '') && attrs.href) {
      found.push(attrs.href);
    }
  }
  return found;
}

function scriptSources(html: string): string[] {
  const contentUrls = [...html.matchAll(JSON_CONTENT_URL)].map((match) => decode(match[1] as string));
  const mediaUrls = [...html.matchAll(MEDIA_URL)].map((match) => decode(match[1] as string));
  return [...contentUrls, ...mediaUrls];
}

function absolute(candidate: string, base: string): string | null {
  if (candidate.startsWith('blob:') || candidate.startsWith('data:')) {
    return null;
  }
  try {
    const url = new URL(candidate, base);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

export function pageMediaSources(html: string, baseUrl: string): string[] {
  const ordered = [...tagSources(html), ...metaSources(html), ...scriptSources(html)];
  const unique = new Set<string>();
  for (const candidate of ordered) {
    const url = absolute(candidate, baseUrl);
    if (url) {
      unique.add(url);
    }
  }
  return [...unique].slice(0, MAX_CANDIDATES);
}

export function pageTitle(html: string): string | null {
  for (const match of html.matchAll(META)) {
    const attrs = attributesOf(match[0]);
    if ((attrs.property || '').toLowerCase() === 'og:title' && attrs.content) {
      return attrs.content;
    }
  }
  const title = TITLE.exec(html);
  if (!title) {
    return null;
  }
  const text = decode(title[1] as string);
  if (!text) {
    return null;
  }
  return text;
}

const THUMBNAIL_KEYS = ['og:image:secure_url', 'og:image', 'og:image:url', 'twitter:image', 'twitter:image:src'];
const JSON_THUMBNAIL = /"thumbnailUrl"\s*:\s*(?:\[\s*)?"([^"]+)"/i;
const POSTER = /<video\b[^>]*\bposter\s*=\s*(?:"([^"]+)"|'([^']+)')/i;

function metaThumbnail(html: string): string | null {
  const found = new Map<string, string>();
  for (const match of html.matchAll(META)) {
    const attrs = attributesOf(match[0]);
    const key = (attrs.property || attrs.name || '').toLowerCase();
    if (THUMBNAIL_KEYS.includes(key) && attrs.content && !found.has(key)) {
      found.set(key, attrs.content);
    }
  }
  const key = THUMBNAIL_KEYS.find((name) => found.has(name));
  if (!key) {
    return null;
  }
  return found.get(key) as string;
}

function posterThumbnail(html: string): string | null {
  const match = POSTER.exec(html);
  if (!match) {
    return null;
  }
  return decode((match[1] || match[2]) as string);
}

function jsonThumbnail(html: string): string | null {
  const match = JSON_THUMBNAIL.exec(html);
  if (!match) {
    return null;
  }
  return decode(match[1] as string);
}

export function pageThumbnail(html: string, baseUrl: string): string | null {
  for (const candidate of [posterThumbnail(html), metaThumbnail(html), jsonThumbnail(html)]) {
    const url = candidate ? absolute(candidate, baseUrl) : null;
    if (url) {
      return url;
    }
  }
  return null;
}
