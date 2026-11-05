import { TtlCache } from '../utils/ttl-cache.js';
import { createLimiter } from '../utils/limiter.js';

export interface OoniCounts {
  measurements: number;
  anomalies: number;
  confirmed: number;
  failures: number;
  ok: number;
}

export interface OoniNetwork extends OoniCounts {
  asn: string;
}

export interface OoniSummary {
  windowDays: number;
  recentDays: number;
  total: OoniCounts;
  recent: OoniCounts;
  lastMeasuredDay: string | null;
  networks: OoniNetwork[];
}

export interface OoniRow {
  measurement_start_day: string;
  probe_asn?: number | string;
  measurement_count: number;
  anomaly_count: number;
  confirmed_count: number;
  failure_count: number;
  ok_count: number;
}

export interface OoniLookup {
  summary(domain: string): Promise<OoniSummary | null>;
}

interface OoniOptions {
  baseUrl: string;
  country: string;
  enabled: boolean;
  fetchFn?: typeof fetch;
  now?: () => number;
}

const WINDOW_DAYS = 30;
const RECENT_DAYS = 7;
const DAY_MS = 86_400_000;
const SUCCESS_TTL_MS = 12 * 3_600_000;
const FAILURE_TTL_MS = 5 * 60_000;
const MAX_BACKOFF_MS = 30 * 60_000;

class OoniHttpError extends Error {
  constructor(readonly status: number) {
    super(`ooni_http_${status}`);
  }
}

function isTransient(error: unknown): boolean {
  if (error instanceof OoniHttpError) {
    return error.status === 429 || error.status >= 500;
  }
  return true;
}

const emptyCounts = (): OoniCounts => ({ measurements: 0, anomalies: 0, confirmed: 0, failures: 0, ok: 0 });

function addRow(target: OoniCounts, row: OoniRow): void {
  target.measurements += row.measurement_count;
  target.anomalies += row.anomaly_count;
  target.confirmed += row.confirmed_count;
  target.failures += row.failure_count;
  target.ok += row.ok_count;
}

export function summarizeOoni(rows: OoniRow[], now: number): OoniSummary {
  const total = emptyCounts();
  const recent = emptyCounts();
  const networks = new Map<string, OoniNetwork>();
  const recentSince = now - RECENT_DAYS * DAY_MS;
  let lastMeasured = 0;

  for (const row of rows) {
    const day = Date.parse(row.measurement_start_day);
    if (!Number.isFinite(day) || row.measurement_count === 0) {
      continue;
    }
    addRow(total, row);
    lastMeasured = Math.max(lastMeasured, day);
    if (day < recentSince) {
      continue;
    }
    addRow(recent, row);
    const asn = row.probe_asn === undefined ? 'unknown' : `AS${row.probe_asn}`;
    const network = networks.get(asn) ?? { asn, ...emptyCounts() };
    addRow(network, row);
    networks.set(asn, network);
  }

  return {
    windowDays: WINDOW_DAYS,
    recentDays: RECENT_DAYS,
    total,
    recent,
    lastMeasuredDay: lastMeasured ? new Date(lastMeasured).toISOString().slice(0, 10) : null,
    networks: [...networks.values()].sort((a, b) => b.measurements - a.measurements).slice(0, 8),
  };
}

export function createOoniService(options: OoniOptions): OoniLookup {
  const fetchFn = options.fetchFn ?? fetch;
  const now = options.now ?? Date.now;
  const cache = new TtlCache<string, OoniSummary | null>(5000, now);
  const limit = createLimiter(4);
  let consecutiveFailures = 0;
  let pausedUntil = 0;

  async function fetchRows(host: string): Promise<OoniRow[]> {
    const url = new URL('/api/v1/aggregation', options.baseUrl);
    url.searchParams.set('probe_cc', options.country);
    url.searchParams.set('domain', host);
    url.searchParams.set('test_name', 'web_connectivity');
    url.searchParams.set('since', new Date(now() - WINDOW_DAYS * DAY_MS).toISOString().slice(0, 10));
    url.searchParams.set('until', new Date(now() + DAY_MS).toISOString().slice(0, 10));
    url.searchParams.set('axis_x', 'measurement_start_day');
    url.searchParams.set('axis_y', 'probe_asn');
    const response = await fetchFn(url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      throw new OoniHttpError(response.status);
    }
    const body = (await response.json()) as { result?: OoniRow[] | OoniRow };
    return Array.isArray(body.result) ? body.result : [];
  }

  async function load(domain: string): Promise<OoniSummary | null> {
    if (now() < pausedUntil) {
      return null;
    }
    try {
      const rowSets = await Promise.all([fetchRows(domain), fetchRows(`www.${domain}`)]);
      consecutiveFailures = 0;
      const summary = summarizeOoni(rowSets.flat(), now());
      cache.set(domain, summary, SUCCESS_TTL_MS);
      return summary;
    } catch (error) {
      if (isTransient(error) && now() >= pausedUntil) {
        consecutiveFailures += 1;
        pausedUntil = now() + Math.min(MAX_BACKOFF_MS, 2 ** consecutiveFailures * 5_000);
      }
      cache.set(domain, null, FAILURE_TTL_MS);
      return null;
    }
  }

  return {
    async summary(domain) {
      if (!options.enabled) {
        return null;
      }
      const cached = cache.get(domain);
      if (cached !== undefined) {
        return cached;
      }
      return limit(() => load(domain));
    },
  };
}
