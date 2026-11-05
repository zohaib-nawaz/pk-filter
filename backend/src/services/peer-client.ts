import type { CheckResult } from './accessibility-service.js';
import type { AccessStatus } from './classification-engine.js';

export interface PeerNetwork {
  isp: string;
  asn: string;
  city: string;
  online: boolean;
}

export interface PeerClient {
  check(domains: string[]): Promise<CheckResult[]>;
  status(): Promise<PeerNetwork>;
}

const CHECK_TIMEOUT_MS = 35_000;
const STATUS_TIMEOUT_MS = 3_000;
const STATUS_CACHE_MS = 30_000;
const STATUSES = new Set<AccessStatus>(['accessible', 'blocked', 'possibly_blocked', 'unknown', 'server_error']);

function isResult(value: unknown): value is CheckResult {
  const item = value as Partial<CheckResult> | null;
  return (
    !!item &&
    typeof item.domain === 'string' &&
    STATUSES.has(item.status as AccessStatus) &&
    typeof item.confidence === 'number' &&
    Number.isFinite(item.ttlSeconds) &&
    typeof item.lastChecked === 'string' &&
    Array.isArray(item.evidence) &&
    !!item.network &&
    typeof item.network.isp === 'string'
  );
}

function offline(): PeerNetwork {
  return { isp: 'unknown', asn: 'unknown', city: 'unknown', online: false };
}

function textOr(value: unknown): string {
  if (typeof value === 'string' && value) {
    return value;
  }
  return 'unknown';
}

export function createPeerClient(baseUrl: string, token: string, fetchFn: typeof fetch = fetch, now: () => number = Date.now): PeerClient {
  const base = baseUrl.replace(/\/+$/, '');
  let lastStatus: { value: PeerNetwork; at: number } | null = null;

  async function readStatus(): Promise<PeerNetwork> {
    try {
      const response = await fetchFn(`${base}/api/v1/status`, {
        headers: { 'x-probe-token': token },
        signal: AbortSignal.timeout(STATUS_TIMEOUT_MS),
      });
      if (!response.ok) {
        return offline();
      }
      const body = (await response.json()) as { network?: { isp?: unknown; asn?: unknown; city?: unknown } };
      if (!body.network) {
        return offline();
      }
      return { isp: textOr(body.network.isp), asn: textOr(body.network.asn), city: textOr(body.network.city), online: true };
    } catch {
      return offline();
    }
  }

  return {
    async check(domains) {
      const response = await fetchFn(`${base}/api/v1/probe`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-probe-token': token },
        body: JSON.stringify({ domains }),
        signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
      });
      if (!response.ok) {
        throw new Error(`peer_${response.status}`);
      }
      const body = (await response.json()) as { results?: unknown[] };
      if (!Array.isArray(body.results)) {
        return [];
      }
      return body.results.filter(isResult);
    },
    async status() {
      if (lastStatus && now() - lastStatus.at < STATUS_CACHE_MS) {
        return lastStatus.value;
      }
      const value = await readStatus();
      lastStatus = { value, at: now() };
      return value;
    },
  };
}
