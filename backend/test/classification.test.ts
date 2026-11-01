import { describe, expect, it } from 'vitest';
import { classify } from '../src/services/classification-engine.js';
import type { DnsResult } from '../src/services/dns-checker.js';
import type { HttpAttempt } from '../src/services/http-checker.js';
import type { OoniCounts, OoniSummary } from '../src/services/ooni-service.js';
import type { ProbeMeasurement } from '../src/services/pakistan-probe.js';

const network = { country: 'PK', isp: 'Test', asn: 'AS1', city: 'Lahore' };

const dnsOk: DnsResult = {
  host: 'example.com',
  resolvers: ['1.1.1.1'],
  a: ['93.184.216.34'],
  aaaa: [],
  cname: [],
  error: null,
  bogon: false,
  control: { resolver: 'doh', nxdomain: false, addresses: ['93.184.216.34'] },
  manipulated: false,
};

const attempt = (fields: Partial<HttpAttempt>): HttpAttempt => ({
  scheme: 'https',
  status: 200,
  finalUrl: 'https://example.com/',
  redirects: 0,
  error: null,
  errorCode: null,
  blockpage: false,
  durationMs: 10,
  ...fields,
});

const failed = (scheme: 'https' | 'http', error: HttpAttempt['error']) => attempt({ scheme, status: null, error });

const measure = (fields: Partial<ProbeMeasurement>): ProbeMeasurement => ({
  domain: 'example.com',
  host: 'example.com',
  dns: dnsOk,
  https: attempt({}),
  http: null,
  network,
  measuredAt: '2026-11-01T00:00:00.000Z',
  ...fields,
});

const counts = (fields: Partial<OoniCounts>): OoniCounts => ({ measurements: 0, anomalies: 0, confirmed: 0, failures: 0, ok: 0, ...fields });

const ooni = (recent: Partial<OoniCounts>): OoniSummary => ({
  windowDays: 30,
  recentDays: 7,
  total: counts(recent),
  recent: counts(recent),
  lastMeasuredDay: '2026-10-31',
  networks: [],
});

describe('classify', () => {
  it('marks a healthy site accessible', () => {
    const result = classify(measure({}), ooni({ measurements: 10, ok: 10 }));
    expect(result.status).toBe('accessible');
    expect(result.confidence).toBeGreaterThanOrEqual(0.9);
    expect(result.evidence.map((e) => e.type)).toEqual(expect.arrayContaining(['dns_resolved', 'https_connection_success', 'ooni_recent_ok']));
  });

  it('treats 403 and 404 as reachable, not blocked', () => {
    for (const status of [403, 404]) {
      expect(classify(measure({ https: attempt({ status }) }), null).status).toBe('accessible');
    }
  });

  it('reports 5xx as server error', () => {
    expect(classify(measure({ https: attempt({ status: 500 }) }), null).status).toBe('server_error');
  });

  it('flags a pakistani blockpage as blocked', () => {
    const result = classify(
      measure({ https: failed('https', 'reset'), http: attempt({ scheme: 'http', blockpage: true }) }),
      null,
    );
    expect(result.status).toBe('blocked');
    expect(result.evidence.map((e) => e.type)).toContain('blockpage_detected');
  });

  it('never calls DNS failure alone blocked', () => {
    const dns: DnsResult = { ...dnsOk, a: [], error: 'timeout', control: null, manipulated: false };
    const result = classify(measure({ dns, https: failed('https', 'dns'), http: failed('http', 'dns') }), null);
    expect(result.status).toBe('unknown');
  });

  it('treats a domain missing everywhere as unknown', () => {
    const dns: DnsResult = { ...dnsOk, a: [], error: 'nxdomain', control: { resolver: 'doh', nxdomain: true, addresses: [] } };
    const result = classify(measure({ dns, https: failed('https', 'dns'), http: failed('http', 'dns') }), ooni({ measurements: 5, confirmed: 5 }));
    expect(result.status).toBe('unknown');
  });

  it('marks DNS manipulation without corroboration as possibly blocked', () => {
    const dns: DnsResult = { ...dnsOk, a: [], error: 'nxdomain', manipulated: true };
    const result = classify(measure({ dns, https: failed('https', 'dns'), http: failed('http', 'dns') }), null);
    expect(result.status).toBe('possibly_blocked');
  });

  it('confirms blocking when live interference matches OONI confirmed measurements', () => {
    const result = classify(
      measure({ https: failed('https', 'reset'), http: failed('http', 'reset') }),
      ooni({ measurements: 6, anomalies: 6, confirmed: 3 }),
    );
    expect(result.status).toBe('blocked');
    expect(result.confidence).toBe(0.9);
  });

  it('does not let historical OONI data override a live success', () => {
    const result = classify(measure({}), ooni({ measurements: 6, anomalies: 6, confirmed: 6 }));
    expect(result.status).toBe('accessible');
    expect(result.confidence).toBe(0.7);
  });

  it('keeps a plain timeout as unknown', () => {
    const result = classify(measure({ https: failed('https', 'timeout'), http: failed('http', 'timeout') }), ooni({ measurements: 10, ok: 10 }));
    expect(result.status).toBe('unknown');
  });

  it('treats TLS errors with no other signal as unknown', () => {
    const result = classify(measure({ https: failed('https', 'tls'), http: failed('http', 'refused') }), null);
    expect(result.status).toBe('unknown');
  });
});
