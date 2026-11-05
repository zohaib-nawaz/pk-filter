export type SiteReportMode = 'failed' | 'check';

export interface SiteReportParams {
  domain: string;
  mode: SiteReportMode;
  url: string | null;
  error: string | null;
}

export const SITE_REPORT_PAGE = 'site/index.html';

export function siteReportQuery(params: SiteReportParams): string {
  const query = new URLSearchParams({ domain: params.domain, mode: params.mode });
  if (params.url) {
    query.set('url', params.url);
  }
  if (params.error) {
    query.set('error', params.error);
  }
  return `${SITE_REPORT_PAGE}?${query.toString()}`;
}

function safeRetryUrl(value: string | null): string | null {
  if (!value) {
    return null;
  }
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

export function parseSiteReport(search: string): SiteReportParams | null {
  const query = new URLSearchParams(search);
  const domain = query.get('domain');
  if (!domain) {
    return null;
  }
  const mode: SiteReportMode = query.get('mode') === 'failed' ? 'failed' : 'check';
  return { domain, mode, url: safeRetryUrl(query.get('url')), error: query.get('error') };
}
