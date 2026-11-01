import type { ProbeNetwork } from '../config.js';
import type { CheckRepository } from '../database/repository.js';
import { TtlCache } from '../utils/ttl-cache.js';
import { createLimiter } from '../utils/limiter.js';
import { classify, ttlFor, type AccessStatus } from './classification-engine.js';
import type { OoniLookup } from './ooni-service.js';
import type { Probe } from './pakistan-probe.js';

export interface CheckResult {
  domain: string;
  status: AccessStatus;
  confidence: number;
  country: string;
  lastChecked: string;
  evidence: string[];
  method: string;
  network: { isp: string; asn: string; city: string };
  ttlSeconds: number;
}

export interface AccessibilityService {
  check(domains: string[]): Promise<CheckResult[]>;
}

interface Dependencies {
  probe: Probe;
  ooni: OoniLookup;
  repository: CheckRepository;
  network: ProbeNetwork;
  concurrency: number;
  onError?: (error: unknown, domain: string) => void;
}

const METHOD = 'DNS + HTTPS/HTTP probe from Pakistan, cross-checked with OONI';
const FAILURE_TTL_SECONDS = 60;

export function createAccessibilityService(deps: Dependencies): AccessibilityService {
  const cache = new TtlCache<string, CheckResult>(20_000);
  const inflight = new Map<string, Promise<CheckResult>>();
  const limit = createLimiter(deps.concurrency);
  const network = { isp: deps.network.isp, asn: deps.network.asn, city: deps.network.city };

  const base = (domain: string) => ({
    domain,
    country: deps.network.country,
    lastChecked: new Date().toISOString(),
    method: METHOD,
    network,
  });

  async function evaluate(domain: string): Promise<CheckResult> {
    try {
      const [measurement, ooni] = await Promise.all([limit(() => deps.probe(domain)), deps.ooni.summary(domain)]);
      const { status, confidence, evidence } = classify(measurement, ooni);
      const result: CheckResult = {
        ...base(domain),
        status,
        confidence,
        lastChecked: measurement.measuredAt,
        evidence: [...new Set(evidence.map((item) => item.type))],
        ttlSeconds: ttlFor(status),
      };
      cache.set(domain, result, result.ttlSeconds * 1000);
      deps.repository
        .saveCheck({
          domain,
          country: result.country,
          status,
          confidence,
          checkedAt: result.lastChecked,
          testSource: `probe:${network.asn}+ooni`,
          evidence,
          measurement,
        })
        .catch((error) => deps.onError?.(error, domain));
      return result;
    } catch (error) {
      deps.onError?.(error, domain);
      const result: CheckResult = {
        ...base(domain),
        status: 'unknown',
        confidence: 0,
        evidence: ['probe_error'],
        ttlSeconds: FAILURE_TTL_SECONDS,
      };
      cache.set(domain, result, FAILURE_TTL_SECONDS * 1000);
      return result;
    }
  }

  function checkOne(domain: string): Promise<CheckResult> {
    const cached = cache.get(domain);
    if (cached) return Promise.resolve(cached);
    const pending = inflight.get(domain);
    if (pending) return pending;
    const task = evaluate(domain).finally(() => inflight.delete(domain));
    inflight.set(domain, task);
    return task;
  }

  return {
    check: (domains) => Promise.all(domains.map(checkOne)),
  };
}
