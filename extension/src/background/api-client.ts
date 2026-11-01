import type { AccessStatus, CheckResult, ServiceStatus } from '../core/types';

const API_URL = __API_URL__.replace(/\/+$/, '');
const STATUSES = new Set<AccessStatus>(['accessible', 'blocked', 'possibly_blocked', 'unknown', 'server_error']);

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

export async function postCheck(domains: string[]): Promise<CheckResult[]> {
  const response = await fetch(`${API_URL}/api/v1/check`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ domains, country: 'PK' }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(response.status === 429 ? 'Rate limited by the checking service' : `Service error ${response.status}`);
  const body = (await response.json()) as { results?: unknown[] };
  return (body.results ?? []).filter(isCheckResult);
}

export async function getServiceStatus(): Promise<ServiceStatus> {
  try {
    const response = await fetch(`${API_URL}/api/v1/status`, { signal: AbortSignal.timeout(8_000) });
    if (!response.ok) throw new Error();
    const body = (await response.json()) as Partial<ServiceStatus> & { country?: string };
    return { online: true, country: body.country ?? null, network: body.network ?? null, ooni: body.ooni === true };
  } catch {
    return { online: false, country: null, network: null, ooni: false };
  }
}
