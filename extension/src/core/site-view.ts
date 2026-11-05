import { normalizeDomain } from './domain';
import { alternativesFor, needsAlternatives, type AlternativeLink } from './alternatives';
import { formatNetwork, formatRelative } from './format';
import { effectiveResult, isSplitDecision, networksOf } from './networks';
import { STATUS_META } from './status-meta';
import type { AccessStatus, SiteStatus } from './types';

export const HISTORY_DAYS = 30;

export interface StatusChip {
  label: string;
  color: string;
}

export interface NetworkChip extends StatusChip {
  isp: string;
}

export interface HistoryCell {
  day: string;
  color: string;
  title: string;
}

export interface SiteCardView {
  domain: string;
  statusKey: AccessStatus;
  status: StatusChip;
  checked: string;
  networks: NetworkChip[];
  history: HistoryCell[] | null;
  blockedSince: string | null;
  alternatives: AlternativeLink[];
}

const NO_DATA_COLOR = '#e8eaed';
const DAY_MS = 86_400_000;

function dayKey(time: number): string {
  return new Date(time).toISOString().slice(0, 10);
}

function historyCells(site: SiteStatus, now: number): HistoryCell[] | null {
  if (!site.history?.available) {
    return null;
  }
  const byDay = new Map(site.history.days.map((entry) => [entry.day, entry.status]));
  const cells: HistoryCell[] = [];
  for (let offset = HISTORY_DAYS - 1; offset >= 0; offset -= 1) {
    const day = dayKey(now - offset * DAY_MS);
    const status = byDay.get(day);
    cells.push({
      day,
      color: status ? STATUS_META[status].color : NO_DATA_COLOR,
      title: `${day}: ${status ? STATUS_META[status].label : 'Not checked'}`,
    });
  }
  return cells;
}

export function siteCardView(site: SiteStatus, preferredIsp: string, now: number = Date.now()): SiteCardView | null {
  if (!site.result) {
    return null;
  }
  const shown = effectiveResult(site.result, preferredIsp);
  const meta = STATUS_META[shown.status];
  const networks = networksOf(site.result);
  return {
    domain: site.domain,
    statusKey: shown.status,
    status: { label: isSplitDecision(shown) ? 'Blocked on some ISPs' : meta.label, color: meta.color },
    checked: `Checked ${formatRelative(shown.lastChecked, now).toLowerCase()} · ${formatNetwork(shown.network)}`,
    networks:
      networks.length > 1
        ? networks.map((network) => ({ isp: network.isp, label: STATUS_META[network.status].label, color: STATUS_META[network.status].color }))
        : [],
    history: historyCells(site, now),
    blockedSince: site.history?.blockedSince ?? null,
    alternatives: needsAlternatives(shown.status) ? alternativesFor(site.domain) : [],
  };
}

export function siteDomainFromUrl(url: string | undefined): string | null {
  if (!url) {
    return null;
  }
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    return parsed.hostname;
  } catch {
    return null;
  }
}

const VERDICTS: Record<AccessStatus, string> = {
  blocked: 'This site appears to be blocked in Pakistan. The archived copy below may still open.',
  possibly_blocked: 'This site may be blocked on some Pakistani networks. Try again later or open the archived copy.',
  accessible: 'This site opens from Pakistan, so the problem is more likely the site itself or your connection.',
  server_error: 'The site itself is returning errors, which is not a sign of blocking.',
  unknown: 'There is not enough data yet to say whether this site is blocked.',
};

export function verdictFor(status: AccessStatus): string {
  return VERDICTS[status];
}

export function domainFromUrl(url: string | undefined): string | null {
  const host = siteDomainFromUrl(url);
  if (!host) {
    return null;
  }
  return normalizeDomain(host);
}
