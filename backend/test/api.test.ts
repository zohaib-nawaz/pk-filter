import { describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import { nullRepository } from '../src/database/repository.js';
import { createAccessibilityService } from '../src/services/accessibility-service.js';
import type { ProbeMeasurement } from '../src/services/pakistan-probe.js';

const network = { country: 'PK', isp: 'Test', asn: 'AS1', city: 'Lahore' };

function fakeProbe() {
  return vi.fn(async (domain: string): Promise<ProbeMeasurement> => ({
    domain,
    host: domain,
    dns: { host: domain, resolvers: [], a: ['93.184.216.34'], aaaa: [], cname: [], error: null, bogon: false, control: null, manipulated: false },
    https: { scheme: 'https', status: 200, finalUrl: `https://${domain}/`, redirects: 0, error: null, errorCode: null, blockpage: false, durationMs: 5 },
    http: null,
    network,
    measuredAt: new Date().toISOString(),
  }));
}

async function setup(rateLimitPerMinute = 100) {
  const probe = fakeProbe();
  const service = createAccessibilityService({
    probe,
    ooni: { summary: async () => null },
    repository: nullRepository,
    network,
    concurrency: 2,
  });
  const app = await buildApp({ service, network, ooniEnabled: false, persistence: false, rateLimitPerMinute });
  return { app, probe };
}

describe('POST /api/v1/check', () => {
  it('checks batches, dedupes and rejects unsafe domains', async () => {
    const { app, probe } = await setup();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/check',
      payload: { domains: ['example.com', 'www.example.com', 'localhost', '10.0.0.1'], country: 'PK' },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.results).toHaveLength(1);
    expect(body.results[0]).toMatchObject({ domain: 'example.com', status: 'accessible', country: 'PK' });
    expect(body.rejected).toEqual(['localhost', '10.0.0.1']);
    expect(probe).toHaveBeenCalledTimes(1);

    await app.inject({ method: 'POST', url: '/api/v1/check', payload: { domains: ['example.com'] } });
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it('validates the payload', async () => {
    const { app } = await setup();
    const tooMany = Array.from({ length: 21 }, (_, i) => `site${i}.com`);
    for (const payload of [{}, { domains: [] }, { domains: tooMany }, { domains: ['a.com'], country: 'PAK' }]) {
      const response = await app.inject({ method: 'POST', url: '/api/v1/check', payload });
      expect(response.statusCode, JSON.stringify(payload)).toBe(400);
    }
  });

  it('applies rate limiting', async () => {
    const { app } = await setup(2);
    const codes = [];
    for (let i = 0; i < 3; i += 1) {
      codes.push((await app.inject({ method: 'GET', url: '/api/v1/status' })).statusCode);
    }
    expect(codes).toEqual([200, 200, 429]);
  });
});
