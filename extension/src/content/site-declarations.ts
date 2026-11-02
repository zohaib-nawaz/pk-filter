import { sourceKind } from '../core/media';

export const DOWNLOAD_ATTRIBUTE = 'data-download-url';

const MAX_LEVELS = 6;
const ALTERNATE_TYPES = /mpegurl|dash\+xml|^video\/|^audio\//i;
const OG_VIDEO_SELECTOR = 'meta[property="og:video:secure_url"], meta[property="og:video:url"], meta[property="og:video"]';

function absolute(value: string | null | undefined): string | null {
  const raw = value?.trim();
  if (!raw) {
    return null;
  }
  const kind = sourceKind(raw, location.href);
  if (kind === 'invalid' || kind === 'blob') {
    return null;
  }
  return new URL(raw, location.href).toString();
}

export function declaredForElement(element: Element): string | null {
  let node: Element | null = element;
  for (let level = 0; node && level < MAX_LEVELS; level += 1) {
    const url = absolute(node.getAttribute(DOWNLOAD_ATTRIBUTE));
    if (url) {
      return url;
    }
    node = node.parentElement;
  }
  return null;
}

export function declaredOnPage(): string[] {
  const alternates = [...document.querySelectorAll<HTMLLinkElement>('link[rel~="alternate"][href]')]
    .filter((link) => ALTERNATE_TYPES.test(link.type))
    .map((link) => absolute(link.getAttribute('href')));
  const ogStreams = [...document.querySelectorAll<HTMLMetaElement>(OG_VIDEO_SELECTOR)]
    .map((meta) => absolute(meta.content))
    .filter((url) => url !== null && sourceKind(url) === 'streaming');
  return [...new Set([...alternates, ...ogStreams].filter((url): url is string => url !== null))];
}
