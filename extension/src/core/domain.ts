const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;
const TLD = /^(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/;
const GOOGLE_HOST = /(^|\.)google\.[a-z.]{2,6}$/;
const URL_LIKE = /^(https?:\/\/)?[a-z0-9.-]+\.[a-z]{2,}/i;

const PLATFORM_DOMAINS: Record<string, string> = {
  youtube: 'youtube.com',
  facebook: 'facebook.com',
  instagram: 'instagram.com',
  x: 'x.com',
  twitter: 'x.com',
  tiktok: 'tiktok.com',
  linkedin: 'linkedin.com',
  reddit: 'reddit.com',
  quora: 'quora.com',
  pinterest: 'pinterest.com',
  wikipedia: 'wikipedia.org',
};

function parseUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

export function normalizeDomain(hostname: string): string | null {
  const host = hostname.trim().toLowerCase().replace(/\.$/, '').replace(/^www\./, '');
  if (host.length > 253) return null;
  const labels = host.split('.');
  if (labels.length < 2 || !TLD.test(labels.at(-1) ?? '')) return null;
  return labels.every((label) => LABEL.test(label)) ? host : null;
}

export function isGoogleHost(hostname: string): boolean {
  return GOOGLE_HOST.test(hostname.toLowerCase());
}

export function domainFromHref(href: string | null, base: string): string | null {
  if (!href) return null;
  const url = parseUrl(new URL(href, base).toString());
  if (!url) return null;
  if (isGoogleHost(url.hostname)) {
    const target = url.searchParams.get('q') ?? url.searchParams.get('url');
    const inner = target ? parseUrl(target) : null;
    return inner && !isGoogleHost(inner.hostname) ? normalizeDomain(inner.hostname) : null;
  }
  return normalizeDomain(url.hostname);
}

export function domainFromDisplayedUrl(text: string | null): string | null {
  const first = text?.trim().split(/\s|›/)[0] ?? '';
  if (!URL_LIKE.test(first)) return null;
  const url = parseUrl(first.includes('://') ? first : `https://${first}`);
  return url && !isGoogleHost(url.hostname) ? normalizeDomain(url.hostname) : null;
}

export function domainFromSiteName(text: string | null): string | null {
  const name = text?.split('·')[0]?.trim().toLowerCase() ?? '';
  return PLATFORM_DOMAINS[name] ?? null;
}
