import searchSites from './search-sites.json';

export const SEARCH_PAGE_MATCHES: string[] = searchSites.matches;

function hostOf(pattern: string): string {
  return new URL(pattern.replace(/\*/g, '')).hostname;
}

function patternRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`);
}

const GOOGLE_HOSTS = new Set(SEARCH_PAGE_MATCHES.map(hostOf).filter((host) => /(^|\.)google\./.test(host)));
const PAGE_PATTERNS = SEARCH_PAGE_MATCHES.map(patternRegex);

export function isGoogleSearchHost(hostname: string): boolean {
  return GOOGLE_HOSTS.has(hostname.toLowerCase());
}

export function isSearchPageUrl(url: string): boolean {
  return PAGE_PATTERNS.some((pattern) => pattern.test(url));
}
