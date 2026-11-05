import { googleEngine, type SearchEngine } from './search-engines';

export const CLAIM_ATTRIBUTE = 'data-pkaf';

export interface SearchResult {
  container: HTMLElement;
  anchor: HTMLAnchorElement;
  title: string;
  domain: string;
  displayedUrl: string | null;
  heading: HTMLElement;
}

export function claimResults(root: ParentNode, base: string, engine: SearchEngine = googleEngine): SearchResult[] {
  const results: SearchResult[] = [];
  for (const heading of root.querySelectorAll<HTMLElement>(engine.headings)) {
    const anchor = engine.anchorOf(heading);
    if (!anchor || heading.closest(engine.excluded)) {
      continue;
    }
    const container = engine.containerOf(anchor);
    if (!container || container.closest(`[${CLAIM_ATTRIBUTE}]`)) {
      continue;
    }
    const domain = engine.domainOf(anchor, container, base);
    if (!domain) {
      continue;
    }
    container.setAttribute(CLAIM_ATTRIBUTE, domain);
    const cite = engine.citeOf(anchor, container);
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
  for (const element of root.querySelectorAll(`[${CLAIM_ATTRIBUTE}]`)) {
    element.removeAttribute(CLAIM_ATTRIBUTE);
  }
}
