import { backoffDelay, chunk } from '../core/cache-policy';
import { normalizeDomain } from '../core/domain';
import { createLimiter } from '../core/limiter';
import type { CheckResult } from '../core/types';
import { loadSettings, pruneCache, readCache, writeCache, writeSync } from '../shared/storage';
import { postCheck } from './api-client';

const BATCH_SIZE = 20;
const MAX_DOMAINS_PER_PAGE = 60;
const limit = createLimiter(2);
const inflight = new Map<string, Promise<CheckResult | null>>();
let failures = 0;
let pausedUntil = 0;

function unavailable(domain: string): CheckResult {
  return {
    domain,
    status: 'unknown',
    confidence: 0,
    country: 'PK',
    lastChecked: new Date().toISOString(),
    evidence: ['service_unavailable'],
    method: 'Not measured',
    network: { isp: 'unknown', asn: 'unknown', city: 'unknown' },
    ttlSeconds: 0,
  };
}

function serviceError(error: unknown): string {
  const unreachable = error instanceof TypeError || (error instanceof DOMException && error.name === 'TimeoutError');
  if (unreachable || !(error instanceof Error)) {
    return 'Could not reach the checking service';
  }
  return error.message;
}

async function remember(results: CheckResult[]): Promise<void> {
  const now = Date.now();
  try {
    await writeCache(results, await loadSettings(), now);
  } catch {
    await pruneCache(now).catch(() => undefined);
  }
  await writeSync({ lastSync: new Date(now).toISOString(), lastError: null }).catch(() => undefined);
}

async function fetchBatch(domains: string[]): Promise<Map<string, CheckResult>> {
  if (Date.now() < pausedUntil) {
    return new Map();
  }
  let results: CheckResult[];
  try {
    results = await postCheck(domains);
  } catch (error) {
    failures += 1;
    pausedUntil = Date.now() + backoffDelay(failures);
    await writeSync({ lastError: serviceError(error) }).catch(() => undefined);
    return new Map();
  }
  failures = 0;
  await remember(results);
  return new Map(results.map((result) => [result.domain, result]));
}

function schedule(domains: string[]): void {
  for (const batch of chunk(domains, BATCH_SIZE)) {
    const pending = limit(() => fetchBatch(batch));
    for (const domain of batch) {
      const task = pending.then((results) => results.get(domain) ?? null).finally(() => inflight.delete(domain));
      inflight.set(domain, task);
    }
  }
}

export function resetBackoff(): void {
  failures = 0;
  pausedUntil = 0;
}

function normalizeAll(input: string[]): string[] {
  return [...new Set(input.map(normalizeDomain).filter((d): d is string => d !== null))].slice(0, MAX_DOMAINS_PER_PAGE);
}

export function lookupCached(input: string[]): Promise<Record<string, CheckResult>> {
  return readCache(normalizeAll(input), Date.now());
}

export async function checkDomains(input: string[]): Promise<Record<string, CheckResult>> {
  const domains = normalizeAll(input);
  const now = Date.now();
  const cached = await readCache(domains, now);
  schedule(domains.filter((domain) => !cached[domain] && !inflight.has(domain)));
  const fresh = await Promise.all(
    domains.filter((domain) => !cached[domain]).map(async (domain) => (await inflight.get(domain)) ?? unavailable(domain)),
  );
  if (Math.random() < 0.1) {
    void pruneCache(now);
  }
  return { ...cached, ...Object.fromEntries(fresh.map((result) => [result.domain, result])) };
}
