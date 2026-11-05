import { domainFromBingHref, domainFromDisplayedUrl, domainFromHref, domainFromSiteName, isBingHost, normalizeDomain } from '../core/domain';

export type SearchEngineId = 'google' | 'bing' | 'duckduckgo';

export interface SearchEngine {
  id: SearchEngineId;
  headings: string;
  excluded: string;
  anchorOf(heading: HTMLElement): HTMLAnchorElement | null;
  containerOf(anchor: HTMLAnchorElement): HTMLElement | null;
  citeOf(anchor: HTMLAnchorElement, container: HTMLElement): Element | null;
  domainOf(anchor: HTMLAnchorElement, container: HTMLElement, base: string): string | null;
  noticeAnchor(): Element | null;
}

const GOOGLE_EXCLUDED = [
  '#tads',
  '#tadsb',
  '#bottomads',
  '#rhs',
  '[data-text-ad]',
  '.commercial-unit-desktop-top',
  '.xpdopen',
  '.related-question-pair',
  'block-component',
  'g-section-with-header',
  'g-scrolling-carousel',
  'g-accordion-expander',
  '.kp-wholepage',
].join(',');

export const googleEngine: SearchEngine = {
  id: 'google',
  headings: '#search a h3, #botstuff a h3',
  excluded: GOOGLE_EXCLUDED,
  anchorOf: (heading) => heading.closest<HTMLAnchorElement>('a[href]'),
  containerOf: (anchor) => anchor.closest<HTMLElement>('[data-hveid]') ?? anchor.closest<HTMLElement>('.MjjYud, .g'),
  citeOf: (anchor) => anchor.querySelector('cite'),
  domainOf: (anchor, _container, base) =>
    domainFromHref(anchor.getAttribute('href'), base) ??
    domainFromDisplayedUrl(anchor.querySelector('cite')?.textContent ?? null) ??
    domainFromSiteName(anchor.querySelector('.VuuXrf')?.textContent ?? null),
  noticeAnchor: () => document.getElementById('rso'),
};

function directDomain(href: string | null, base: string): string | null {
  if (!href) {
    return null;
  }
  try {
    const url = new URL(href, base);
    const isWeb = url.protocol === 'http:' || url.protocol === 'https:';
    return isWeb && !isBingHost(url.hostname) ? normalizeDomain(url.hostname) : null;
  } catch {
    return null;
  }
}

export const bingEngine: SearchEngine = {
  id: 'bing',
  headings: '#b_results > li.b_algo h2',
  excluded: '.b_ad, .b_adTop, .b_adBottom',
  anchorOf: (heading) => heading.querySelector<HTMLAnchorElement>('a[href]'),
  containerOf: (anchor) => anchor.closest<HTMLElement>('li.b_algo'),
  citeOf: (_anchor, container) => container.querySelector('cite'),
  domainOf: (anchor, container, base) =>
    domainFromBingHref(anchor.getAttribute('href'), base) ??
    domainFromDisplayedUrl(container.querySelector('cite')?.textContent ?? null) ??
    directDomain(anchor.getAttribute('href'), base),
  noticeAnchor: () => document.getElementById('b_results'),
};

export const duckDuckGoEngine: SearchEngine = {
  id: 'duckduckgo',
  headings: 'article[data-testid="result"] h2',
  excluded: '[data-testid="ad"]',
  anchorOf: (heading) => heading.querySelector<HTMLAnchorElement>('a[href]'),
  containerOf: (anchor) => anchor.closest<HTMLElement>('li') ?? anchor.closest<HTMLElement>('article'),
  citeOf: () => null,
  domainOf: (anchor, _container, base) => directDomain(anchor.getAttribute('href'), base),
  noticeAnchor: () => document.querySelector('ol.react-results--main'),
};

export function engineFor(hostname: string): SearchEngine | null {
  const host = hostname.toLowerCase();
  if (/(^|\.)google\.com(\.pk)?$/.test(host)) {
    return googleEngine;
  }
  if (isBingHost(host)) {
    return bingEngine;
  }
  if (/(^|\.)duckduckgo\.com$/.test(host)) {
    return duckDuckGoEngine;
  }
  return null;
}
