import { TtlCache } from '../utils/ttl-cache.js';
import type { AccessibilityService, CheckResult } from './accessibility-service.js';
import { classifyFromOoni, ttlFor } from './classification-engine.js';
import type { OoniLookup } from './ooni-service.js';

const CACHE_SIZE = 5_000;
const OONI_NETWORK = { isp: 'OONI reports', asn: 'unknown', city: 'unknown' };

export function createOoniOnlyService(country: string, ooni: OoniLookup, onError?: (error: unknown) => void): AccessibilityService {
  const cache = new TtlCache<string, CheckResult>(CACHE_SIZE);
  const inflight = new Map<string, Promise<CheckResult>>();

  async function evaluate(domain: string): Promise<CheckResult> {
    let summary = null;
    try {
      summary = await ooni.summary(domain);
    } catch (error) {
      onError?.(error);
    }
    const { status, confidence, evidence } = classifyFromOoni(summary);
    const result: CheckResult = {
      domain,
      status,
      confidence,
      country,
      lastChecked: new Date().toISOString(),
      evidence: evidence.map((item) => item.type),
      method: `OONI volunteer measurements from ${country}`,
      network: OONI_NETWORK,
      ttlSeconds: ttlFor(status),
    };
    cache.set(domain, result, result.ttlSeconds * 1000);
    return result;
  }

  function checkOne(domain: string): Promise<CheckResult> {
    const cached = cache.get(domain);
    if (cached) {
      return Promise.resolve(cached);
    }
    const pending = inflight.get(domain);
    if (pending) {
      return pending;
    }
    const task = evaluate(domain).finally(() => inflight.delete(domain));
    inflight.set(domain, task);
    return task;
  }

  return {
    check: (domains) => Promise.all(domains.map(checkOne)),
    drain: async () => {
      await Promise.allSettled([...inflight.values()]);
    },
  };
}
