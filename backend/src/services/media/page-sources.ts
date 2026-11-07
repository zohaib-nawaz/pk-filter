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

export interface PageImage {
  label: string;
  url: string;
  trimBars?: boolean;
}

const THUMBNAIL_KEYS: Record<string, string> = {
  'og:image:secure_url': 'Share image',
  'og:image': 'Share image',
  'og:image:url': 'Share image',
  'twitter:image': 'Card image',
  'twitter:image:src': 'Card image',
};
const JSON_THUMBNAIL = /"thumbnailUrl"\s*:\s*(?:\[\s*)?"([^"]+)"/gi;
const POSTER = /<video\b[^>]*\bposter\s*=\s*(?:"([^"]+)"|'([^']+)')/gi;
const MAX_PAGE_IMAGES = 12;

function metaThumbnails(html: string): PageImage[] {
  const keys = Object.keys(THUMBNAIL_KEYS);
  const found: Array<PageImage & { rank: number }> = [];
  for (const match of html.matchAll(META)) {
    const attrs = attributesOf(match[0]);
    const key = (attrs.property || attrs.name || '').toLowerCase();
    const label = THUMBNAIL_KEYS[key];
    if (attrs.content && label) {
      found.push({ label, url: attrs.content, rank: keys.indexOf(key) });
    }
  }
  return found.sort((a, b) => a.rank - b.rank).map(({ label, url }) => ({ label, url }));
}

function posterThumbnails(html: string): PageImage[] {
  return [...html.matchAll(POSTER)].map((match) => ({ label: 'Video poster', url: decode((match[1] || match[2]) as string) }));
}

function jsonThumbnails(html: string): PageImage[] {
  return [...html.matchAll(JSON_THUMBNAIL)].map((match) => ({ label: 'Video thumbnail', url: decode(match[1] as string) }));
}

export function pageThumbnails(html: string, baseUrl: string): PageImage[] {
  const seen = new Set<string>();
  const images: PageImage[] = [];
  for (const candidate of [...posterThumbnails(html), ...metaThumbnails(html), ...jsonThumbnails(html)]) {
    const url = absolute(candidate.url, baseUrl);
    if (url && !seen.has(url) && images.length < MAX_PAGE_IMAGES) {
      seen.add(url);
      images.push({ label: candidate.label, url });
    }
  }
  return images;
}

export function pageThumbnail(html: string, baseUrl: string): string | null {
  const [first] = pageThumbnails(html, baseUrl);
  if (!first) {
    return null;
  }
  return first.url;
}
