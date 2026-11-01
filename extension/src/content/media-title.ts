import { cleanTitle, titleFromUrl } from '../core/filename';

const TITLE_SELECTORS = ['h1, h2, h3, h4, figcaption', '[class*="title" i], [class*="caption" i]'];
const MAX_LEVELS = 6;

function siteName(): string {
  const meta = document.querySelector<HTMLMetaElement>('meta[property="og:site_name"]')?.content;
  return meta?.trim() || location.hostname.replace(/^www\./, '').split('.')[0] || '';
}

function ownLabel(element: Element, site: string): string {
  return cleanTitle(element.getAttribute('title') ?? element.getAttribute('aria-label'), site);
}

function cardHeading(element: Element, isOtherMedia: (candidate: Element) => boolean, site: string): string {
  let node = element.parentElement;
  for (let level = 0; node && node !== document.body && level < MAX_LEVELS; level += 1) {
    if ([...node.querySelectorAll('video, img')].some((child) => !element.contains(child) && isOtherMedia(child))) break;
    for (const selector of TITLE_SELECTORS) {
      for (const heading of node.querySelectorAll(selector)) {
        if (heading.contains(element)) continue;
        const text = cleanTitle(heading.textContent, site);
        if (text) return text;
      }
    }
    node = node.parentElement;
  }
  return '';
}

function imageAlt(element: Element, site: string): string {
  const image = element instanceof HTMLImageElement ? element : element.querySelector('img');
  return cleanTitle(image?.alt, site);
}

export function mediaTitle(element: Element, url: string, isOtherMedia: (candidate: Element) => boolean): string {
  const site = siteName();
  return (
    ownLabel(element, site) ||
    cardHeading(element, isOtherMedia, site) ||
    imageAlt(element, site) ||
    cleanTitle(document.querySelector<HTMLMetaElement>('meta[property="og:title"]')?.content, site) ||
    cleanTitle(document.title, site) ||
    titleFromUrl(url)
  );
}

export function linkTitle(link: HTMLAnchorElement, url: string, isOtherMedia: (candidate: Element) => boolean): string {
  return cleanTitle(link.textContent, siteName()) || mediaTitle(link, url, isOtherMedia);
}
