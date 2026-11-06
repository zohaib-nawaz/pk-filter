import type { ProbeNetwork } from '../config.js';
import type { CheckRepository } from '../database/repository.js';
import { TtlCache } from '../utils/ttl-cache.js';
import { createLimiter } from '../utils/limiter.js';
import { classify, ttlFor, type AccessStatus } from './classification-engine.js';
import type { OoniLookup } from './ooni-service.js';
import type { NetworkResult } from './network-aggregate.js';
import type { Probe } from './network-probe.js';

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
  networks?: NetworkResult[];
}

export interface AccessibilityService {
  check(domains: string[]): Promise<CheckResult[]>;
  drain(): Promise<void>;
}

interface Dependencies {
  probe: Probe;
  ooni: OoniLookup;
  repository: CheckRepository;
  network: ProbeNetwork;
  concurrency: number;
  requestBudgetMs?: number;
  maxInflight?: number;
  onError?: (error: unknown, domain: string) => void;
}

const METHOD = 'DNS + HTTPS/HTTP test from a local network, cross-checked with OONI';
const FAILURE_TTL_SECONDS = 60;
const PENDING_TTL_SECONDS = 30;
const DEFAULT_REQUEST_BUDGET_MS = 30_000;
const DEFAULT_MAX_INFLIGHT = 500;

export function createAccessibilityService(deps: Dependencies): AccessibilityService {
  const cache = new TtlCache<string, CheckResult>(20_000);
  const inflight = new Map<string, Promise<CheckResult>>();
  const pendingSaves = new Set<Promise<void>>();
  const limit = createLimiter(deps.concurrency);
  const budgetMs = deps.requestBudgetMs ?? DEFAULT_REQUEST_BUDGET_MS;
  const maxInflight = deps.maxInflight ?? DEFAULT_MAX_INFLIGHT;
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
      const save = deps.repository
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
        .catch((error) => deps.onError?.(error, domain))
        .finally(() => pendingSaves.delete(save));
      pendingSaves.add(save);
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

  function provisional(domain: string, reason: string): CheckResult {
    return { ...base(domain), status: 'unknown', confidence: 0, evidence: [reason], ttlSeconds: PENDING_TTL_SECONDS };
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
    if (inflight.size >= maxInflight) {
      return Promise.resolve(provisional(domain, 'server_busy'));
    }
    const task = evaluate(domain).finally(() => inflight.delete(domain));
    inflight.set(domain, task);
    return task;
  }

  async function check(domains: string[]): Promise<CheckResult[]> {
    let timer: NodeJS.Timeout | undefined;
    const expired = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), budgetMs);
    });
    try {
      return await Promise.all(
        domains.map(async (domain) => (await Promise.race([checkOne(domain), expired])) ?? provisional(domain, 'still_checking')),
      );
    } finally {
      clearTimeout(timer);
    }
  }

  async function drain(): Promise<void> {
    await Promise.allSettled([...inflight.values()]);
    await Promise.allSettled([...pendingSaves]);
  }

  return { check, drain };
}
