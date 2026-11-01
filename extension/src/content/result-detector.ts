import { domainFromDisplayedUrl, domainFromHref, domainFromSiteName } from '../core/domain';

export const CLAIM_ATTRIBUTE = 'data-pkaf';

const HEADINGS = '#search a h3, #botstuff a h3';
const EXCLUDED = [
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
const SITE_NAME = '.VuuXrf';

export interface SearchResult {
  container: HTMLElement;
  anchor: HTMLAnchorElement;
  title: string;
  domain: string;
  displayedUrl: string | null;
  heading: HTMLElement;
}

function containerFor(anchor: HTMLAnchorElement): HTMLElement | null {
  return anchor.closest<HTMLElement>('[data-hveid]') ?? anchor.closest<HTMLElement>('.MjjYud, .g');
}

function domainFor(anchor: HTMLAnchorElement, base: string): string | null {
  return (
    domainFromHref(anchor.getAttribute('href'), base) ??
    domainFromDisplayedUrl(anchor.querySelector('cite')?.textContent ?? null) ??
    domainFromSiteName(anchor.querySelector(SITE_NAME)?.textContent ?? null)
  );
}

export function claimResults(root: ParentNode, base: string): SearchResult[] {
  const results: SearchResult[] = [];
  for (const heading of root.querySelectorAll<HTMLElement>(HEADINGS)) {
    const anchor = heading.closest<HTMLAnchorElement>('a[href]');
    if (!anchor || heading.closest(EXCLUDED)) continue;
    const container = containerFor(anchor);
    if (!container || container.closest(`[${CLAIM_ATTRIBUTE}]`)) continue;
    const domain = domainFor(anchor, base);
    if (!domain) continue;
    container.setAttribute(CLAIM_ATTRIBUTE, domain);
    const cite = anchor.querySelector('cite');
    results.push({
      container,
      anchor,
      title: heading.textContent?.trim() ?? '',
      domain,
      displayedUrl: cite?.textContent?.trim() ?? null,
      heading,
    });
  }
  return results;
}

export function releaseAll(root: ParentNode): void {
  for (const element of root.querySelectorAll(`[${CLAIM_ATTRIBUTE}]`)) element.removeAttribute(CLAIM_ATTRIBUTE);
}
