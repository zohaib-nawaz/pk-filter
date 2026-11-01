import { sourceKind } from '../core/media';
import { mediaUrlsFromJsonLd } from '../core/page-metadata';

const META_SELECTOR = [
  'meta[property="og:video:secure_url"]',
  'meta[property="og:video:url"]',
  'meta[property="og:video"]',
  'meta[name="twitter:player:stream"]',
  'meta[property="og:audio:secure_url"]',
  'meta[property="og:audio"]',
].join(',');

export function metadataMediaSources(): string[] {
  const urls = [...document.querySelectorAll<HTMLMetaElement>(META_SELECTOR)].map((meta) => meta.content);
  for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
    urls.push(...mediaUrlsFromJsonLd(script.textContent ?? ''));
  }
  const usable = urls
    .map((url) => url.trim())
    .filter((url) => {
      const kind = sourceKind(url, location.href);
      return kind === 'direct' || kind === 'unknown';
    })
    .map((url) => new URL(url, location.href).toString());
  return [...new Set(usable)];
}
