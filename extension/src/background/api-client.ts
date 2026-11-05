import { isCountryCode } from '../core/countries';
import type { AccessStatus, CheckResult, CountrySource, MeasuredBy, ServiceNetwork, ServiceStatus, SiteHistory, ViewerCountry } from '../core/types';

const API_URL = __API_URL__.replace(/\/+$/, '');
const STATUSES = new Set<AccessStatus>(['accessible', 'blocked', 'possibly_blocked', 'unknown', 'server_error']);
const SOURCES = new Set<CountrySource>(['chosen', 'ip', 'default']);
const MEASURERS = new Set<MeasuredBy>(['probe', 'peer', 'ooni']);

export interface CheckResponse {
  results: CheckResult[];
  country: string;
}

function isCheckResult(value: unknown): value is CheckResult {
  const item = value as Partial<CheckResult> | null;
  return (
    !!item &&
    typeof item.domain === 'string' &&
    STATUSES.has(item.status as AccessStatus) &&
    typeof item.confidence === 'number' &&
    typeof item.lastChecked === 'string' &&
    Array.isArray(item.evidence) &&
    typeof item.ttlSeconds === 'number'
  );
}

function viewerFrom(value: unknown): ViewerCountry | null {
  const body = value as { country?: unknown; source?: unknown; measuredBy?: unknown } | null;
  if (!body || !isCountryCode(body.country)) {
    return null;
  }
  return {
    country: body.country,
    source: SOURCES.has(body.source as CountrySource) ? (body.source as CountrySource) : 'default',
    measuredBy: MEASURERS.has(body.measuredBy as MeasuredBy) ? (body.measuredBy as MeasuredBy) : 'ooni',
  };
}

export async function postCheck(domains: string[], country: string): Promise<CheckResponse> {
  const response = await fetch(`${API_URL}/api/v1/check`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ domains, country }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) {
    throw new Error(response.status === 429 ? 'Rate limited by the checking service' : `Service error ${response.status}`);
  }
  const body = (await response.json()) as { results?: unknown[]; country?: unknown };
  const results = Array.isArray(body.results) ? body.results.filter(isCheckResult) : [];
  return { results, country: isCountryCode(body.country) ? body.country : country };
}

export async function whereAmI(choice: string): Promise<ViewerCountry | null> {
  try {
    const response = await fetch(`${API_URL}/api/v1/whereami?country=${encodeURIComponent(choice)}`, { signal: AbortSignal.timeout(8_000) });
    if (!response.ok) {
      return null;
    }
    return viewerFrom(await response.json());
  } catch {
    return null;
  }
}

function networksFrom(body: { network?: ServiceStatus['network']; networks?: unknown }): ServiceNetwork[] {
  if (Array.isArray(body.networks)) {
    return body.networks as ServiceNetwork[];
  }
  if (body.network) {
    return [{ ...body.network, online: true }];
  }
  return [];
}

const OFFLINE: ServiceStatus = { online: false, country: null, network: null, networks: [], ooni: false, probeCountries: [] };

export async function getServiceStatus(): Promise<ServiceStatus> {
  try {
    const response = await fetch(`${API_URL}/api/v1/status`, { signal: AbortSignal.timeout(8_000) });
    if (!response.ok) {
      return OFFLINE;
    }
    const body = (await response.json()) as Partial<ServiceStatus> & { probeCountries?: unknown };
    const probeCountries = Array.isArray(body.probeCountries) ? body.probeCountries.filter(isCountryCode) : [];
    return {
      online: true,
      country: typeof body.country === 'string' ? body.country : null,
      network: body.network ? body.network : null,
      networks: networksFrom(body),
      ooni: body.ooni === true,
      probeCountries,
    };
  } catch {
    return OFFLINE;
  }
}

export async function getHistory(domain: string, country: string): Promise<SiteHistory | null> {
  try {
    const query = new URLSearchParams({ domain, country });
    const response = await fetch(`${API_URL}/api/v1/history?${query.toString()}`, { signal: AbortSignal.timeout(8_000) });
    if (!response.ok) {
      return null;
    }
    const body = (await response.json()) as Partial<SiteHistory>;
    return {
      available: body.available === true,
      days: Array.isArray(body.days) ? body.days : [],
      blockedSince: typeof body.blockedSince === 'string' ? body.blockedSince : null,
    };
  } catch {
    return null;
  }
}

const TRACE_URL = 'https://www.cloudflare.com/cdn-cgi/trace';

export async function browserCountry(): Promise<string | null> {
  try {
    const response = await fetch(TRACE_URL, { credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(5_000) });
    if (!response.ok) {
      return null;
    }
    const line = (await response.text()).split('\n').find((entry) => entry.startsWith('loc='));
    if (!line) {
      return null;
    }
    const code = line.slice(4).trim().toUpperCase();
    return isCountryCode(code) ? code : null;
  } catch {
    return null;
  }
}
