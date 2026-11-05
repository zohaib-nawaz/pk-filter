import { describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import { nullRepository } from '../src/database/repository.js';
import { createAccessibilityService, type AccessibilityService, type CheckResult } from '../src/services/accessibility-service.js';
import { createMultiNetworkService } from '../src/services/multi-network-service.js';
import { createOoniService } from '../src/services/ooni-service.js';
import type { ProbeMeasurement } from '../src/services/pakistan-probe.js';
import type { PeerClient } from '../src/services/peer-client.js';

const network = { country: 'PK', isp: 'PTCL', asn: 'AS17557', city: 'Karachi' };

const measurement = (domain: string): ProbeMeasurement => ({
  domain,
  host: domain,
  dns: { host: domain, resolvers: [], a: ['93.184.216.34'], aaaa: [], cname: [], error: null, bogon: false, control: null, manipulated: false },
  https: { scheme: 'https', status: 200, finalUrl: `https://${domain}/`, redirects: 0, error: null, errorCode: null, blockpage: false, durationMs: 5 },
  http: null,
  network,
  measuredAt: new Date().toISOString(),
});

const peerResult = (domain: string, ttlSeconds = 600): CheckResult => ({
  domain,
  status: 'accessible',
  confidence: 0.85,
  country: 'PK',
  lastChecked: '2026-11-05T00:00:00.000Z',
  evidence: [],
  method: 'probe',
  network: { isp: 'Jazz', asn: 'AS9', city: 'Lahore' },
  ttlSeconds,
});

const local: AccessibilityService = {
  check: async (domains) => domains.map((domain) => ({ ...peerResult(domain, 1200), network: { isp: 'PTCL', asn: 'AS1', city: 'x' } })),
  drain: async () => undefined,
};

describe('request budget', () => {
  it('answers still_checking when a probe outlives the budget, then finishes it in the background', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const service = createAccessibilityService({
      probe: async (domain) => {
        await gate;
        return measurement(domain);
      },
      ooni: { summary: async () => null },
      repository: nullRepository,
      network,
      concurrency: 2,
      requestBudgetMs: 20,
    });
    const [early] = await service.check(['slow.com']);
    expect(early).toMatchObject({ status: 'unknown', evidence: ['still_checking'], ttlSeconds: 30 });
    release();
    await service.drain();
    const [later] = await service.check(['slow.com']);
    expect(later?.status).toBe('accessible');
  });

  it('refuses new work past the inflight cap without blocking', async () => {
    const service = createAccessibilityService({
      probe: () => new Promise<ProbeMeasurement>(() => undefined),
      ooni: { summary: async () => null },
      repository: nullRepository,
      network,
      concurrency: 1,
      requestBudgetMs: 10,
      maxInflight: 1,
    });
    const results = await service.check(['a.com', 'b.com']);
    expect(results.map((item) => item.evidence[0])).toEqual(['still_checking', 'server_busy']);
  });
});

describe('peer cache and breaker', () => {
  it('reuses cached peer answers and only asks for missing domains', async () => {
    const check = vi.fn(async (domains: string[]) => domains.map((domain) => peerResult(domain)));
    const peer: PeerClient = { check, status: async () => ({ isp: 'Jazz', asn: 'AS9', city: 'Lahore', online: true }) };
    const service = createMultiNetworkService(local, [peer]);
    await service.check(['a.com']);
    const results = await service.check(['a.com', 'b.com']);
    expect(check.mock.calls).toEqual([[['a.com']], [['b.com']]]);
    expect(results.every((item) => item.networks?.length === 2)).toBe(true);
  });

  it('stops calling a failing peer for a minute after three failures', async () => {
    let time = 0;
    const check = vi.fn(async (): Promise<CheckResult[]> => {
      throw new Error('down');
    });
    const peer: PeerClient = { check, status: async () => ({ isp: 'Jazz', asn: 'AS9', city: 'Lahore', online: false }) };
    const service = createMultiNetworkService(local, [peer], undefined, () => time);
    for (let round = 0; round < 5; round += 1) {
      await service.check([`site${round}.com`]);
    }
    expect(check).toHaveBeenCalledTimes(3);
    time = 61_000;
    await service.check(['again.com']);
    expect(check).toHaveBeenCalledTimes(4);
  });
});

describe('ooni pause', () => {
  it('pauses globally only on transient failures', async () => {
    const notFound = vi.fn(async () => new Response('nope', { status: 404 }));
    const service = createOoniService({ baseUrl: 'https://api.ooni.io', country: 'PK', enabled: true, fetchFn: notFound, now: () => 0 });
    await service.summary('a.com');
    await service.summary('b.com');
    expect(notFound).toHaveBeenCalledTimes(4);

    const busy = vi.fn(async () => new Response('busy', { status: 503 }));
    const paused = createOoniService({ baseUrl: 'https://api.ooni.io', country: 'PK', enabled: true, fetchFn: busy, now: () => 0 });
    await paused.summary('a.com');
    await paused.summary('b.com');
    expect(busy).toHaveBeenCalledTimes(2);
  });
});

describe('rate limit', () => {
  it('lets trusted peers through the limit', async () => {
    const app = await buildApp({ service: local, network, ooniEnabled: false, persistence: false, rateLimitPerMinute: 1, probeToken: 'secret' });
    await app.inject({ method: 'GET', url: '/api/v1/status' });
    expect((await app.inject({ method: 'GET', url: '/api/v1/status' })).statusCode).toBe(429);
    const trusted = await app.inject({ method: 'GET', url: '/api/v1/status', headers: { 'x-probe-token': 'secret' } });
    expect(trusted.statusCode).toBe(200);
  });
});
