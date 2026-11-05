import { backoffDelay, chunk } from '../core/cache-policy';
import { normalizeDomain } from '../core/domain';
import { errorMessage } from '../core/errors';
import { createLimiter } from '../core/limiter';
import { mergeLocalCheck } from '../core/local-check';
import type { CheckResult } from '../core/types';
import { loadSettings, pruneCache, readCache, writeCache, writeSync } from '../shared/storage';
import { postCheck } from './api-client';
import { knownLocalProbe, localProbe } from './local-probe';
import { currentViewer } from './viewer';

const BATCH_SIZE = 20;
const MAX_DOMAINS_PER_PAGE = 60;
const limit = createLimiter(2);
const inflight = new Map<string, Promise<CheckResult | null>>();
let failures = 0;
let pausedUntil = 0;

function unavailable(country: string, domain: string): CheckResult {
  return {
    domain,
    status: 'unknown',
    confidence: 0,
    country,
    lastChecked: new Date().toISOString(),
    evidence: ['service_unavailable'],
    method: 'Not measured',
    network: { isp: 'unknown', asn: 'unknown', city: 'unknown' },
    ttlSeconds: 0,
  };
}

function serviceError(error: unknown): string {
  const unreachable = error instanceof TypeError || (error instanceof DOMException && error.name === 'TimeoutError');
  if (unreachable) {
    return 'Could not reach the checking service';
  }
  return errorMessage(error, 'Could not reach the checking service');
}

async function remember(country: string, results: CheckResult[]): Promise<void> {
  const now = Date.now();
  try {
    await writeCache(country, results, await loadSettings(), now);
  } catch {
    await pruneCache(now).catch(() => undefined);
  }
  await writeSync({ lastSync: new Date(now).toISOString(), lastError: null }).catch(() => undefined);
}

async function fetchBatch(country: string, domains: string[]): Promise<Map<string, CheckResult>> {
  if (Date.now() < pausedUntil) {
    return new Map();
  }
  let results: CheckResult[];
  try {
    results = (await postCheck(domains, country)).results;
  } catch (error) {
    failures += 1;
    pausedUntil = Date.now() + backoffDelay(failures);
    await writeSync({ lastError: serviceError(error) }).catch(() => undefined);
    return new Map();
  }
  failures = 0;
  await remember(country, results);
  return new Map(results.map((result) => [result.domain, result]));
}

function inflightKey(country: string, domain: string): string {
  return `${country}:${domain}`;
}

function schedule(country: string, domains: string[]): void {
  for (const batch of chunk(domains, BATCH_SIZE)) {
    const pending = limit(() => fetchBatch(country, batch));
    for (const domain of batch) {
      const key = inflightKey(country, domain);
      const task = pending
        .then((results) => {
          const result = results.get(domain);
          if (!result) {
            return null;
          }
          return result;
        })
        .finally(() => inflight.delete(key));
      inflight.set(key, task);
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

function isMeasuredResult(result: CheckResult): boolean {
  return !result.evidence.includes('service_unavailable');
}

async function withLocalChecks(country: string, results: CheckResult[]): Promise<CheckResult[]> {
  const settings = await loadSettings();
  if (!settings.localCheck) {
    return results;
  }
  return Promise.all(
    results.map(async (result) => {
      if (!isMeasuredResult(result)) {
        return result;
      }
      return mergeLocalCheck(result, await localProbe(country, result.domain));
    }),
  );
}

function byDomain(results: CheckResult[]): Record<string, CheckResult> {
  return Object.fromEntries(results.map((result) => [result.domain, result]));
}

export async function lookupCached(input: string[]): Promise<Record<string, CheckResult>> {
  const { country } = await currentViewer();
  const cached = await readCache(country, normalizeAll(input), Date.now());
  const settings = await loadSettings();
  if (!settings.localCheck) {
    return cached;
  }
  const merged: CheckResult[] = [];
  for (const result of Object.values(cached)) {
    const probe = knownLocalProbe(country, result.domain);
    if (probe) {
      merged.push(mergeLocalCheck(result, probe));
    }
  }
  return byDomain(merged);
}

export async function checkDomains(input: string[]): Promise<Record<string, CheckResult>> {
  const domains = normalizeAll(input);
  const { country } = await currentViewer();
  const now = Date.now();
  const cached = await readCache(country, domains, now);
  schedule(country, domains.filter((domain) => !cached[domain] && !inflight.has(inflightKey(country, domain))));
  const fresh = await Promise.all(
    domains
      .filter((domain) => !cached[domain])
      .map(async (domain) => {
        const result = await inflight.get(inflightKey(country, domain));
        if (!result) {
          return unavailable(country, domain);
        }
        return result;
      }),
  );
  if (Math.random() < 0.1) {
    void pruneCache(now);
  }
  return byDomain(await withLocalChecks(country, [...Object.values(cached), ...fresh]));
}
