import type { DisplayStatus } from './types';

export interface AlternativeLink {
  label: string;
  url: string;
}

const RESTRICTED: DisplayStatus[] = ['blocked', 'possibly_blocked'];

export function needsAlternatives(status: DisplayStatus): boolean {
  return RESTRICTED.includes(status);
}

export function archiveUrl(domain: string): string {
  return `https://web.archive.org/web/2/https://${domain}/`;
}

export function evidenceUrl(domain: string, country: string): string {
  const params = new URLSearchParams({ probe_cc: country, domain, test_name: 'web_connectivity', axis_x: 'measurement_start_day' });
  return `https://explorer.ooni.org/chart/mat?${params.toString()}`;
}

export function alternativesFor(domain: string, country: string): AlternativeLink[] {
  return [
    { label: 'Open archived copy', url: archiveUrl(domain) },
    { label: 'See OONI evidence', url: evidenceUrl(domain, country) },
  ];
}
