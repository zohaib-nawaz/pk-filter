import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import type { AccessibilityService, CheckResult } from '../src/services/accessibility-service.js';
import { classifyFromOoni } from '../src/services/classification-engine.js';
import type { GeoIp } from '../src/services/geoip.js';
import type { OoniDirectory, OoniSummary } from '../src/services/ooni-service.js';
import type { PeerClient } from '../src/services/peer-client.js';
import { createCountryResolver } from '../src/services/viewer-country.js';

const network = { country: 'NL', isp: 'NetOne', asn: 'AS64500', city: 'Capital City' };

const counts = (ok: number, anomalies: number, confirmed: number, failures: number) => ({ measurements: ok + anomalies + confirmed + failures, anomalies, confirmed, failures, ok });

const summary = (ok: number, anomalies: number, confirmed = 0, failures = 0): OoniSummary => ({
  windowDays: 30,
  recentDays: 7,
  total: counts(ok, anomalies, confirmed, failures),
  recent: counts(ok, anomalies, confirmed, failures),
  lastMeasuredDay: '2026-11-04',
  networks: [],
});

const local: AccessibilityService = {
  check: async (domains) =>
    domains.map((domain): CheckResult => ({
      domain,
      status: 'blocked',
      confidence: 0.9,
      country: 'NL',
      lastChecked: '2026-11-05T00:00:00.000Z',
      evidence: ['blockpage_detected'],
      method: 'probe',
      network,
      ttlSeconds: 900,
    })),
  drain: async () => undefined,
};

const ooni: OoniDirectory = {
  forCountry: (country) => ({ summary: async () => (country === 'DE' ? summary(6612, 46, 17, 67) : summary(121, 149, 1244, 36)) }),
};

const geoip: GeoIp = { country: (ip) => ({ '85.214.132.117': 'DE', '5.62.0.1': 'IR' })[ip] ?? null };

async function app(extra: { countryPeers?: Record<string, PeerClient[]> } = {}) {
  return buildApp({ service: local, network, ooniEnabled: true, persistence: false, rateLimitPerMinute: 100, trustProxy: true, ooni, geoip, ...extra });
}

describe('classifyFromOoni', () => {
  it('uses the same evidence rules without a local probe', () => {
    expect(classifyFromOoni(null)).toMatchObject({ status: 'unknown' });
    expect(classifyFromOoni(summary(0, 0, 0, 4)).status).toBe('unknown');
    expect(classifyFromOoni(summary(121, 149, 1244, 36))).toMatchObject({ status: 'blocked', confidence: 0.9 });
    expect(classifyFromOoni(summary(1, 6)).status).toBe('possibly_blocked');
    expect(classifyFromOoni(summary(10, 0)).status).toBe('accessible');
    expect(classifyFromOoni(summary(10, 0)).evidence.map((item) => item.type)).toEqual(['ooni_only', 'ooni_recent_ok']);
    const germany = classifyFromOoni(summary(6612, 46, 17, 67));
    expect(germany.status).toBe('accessible');
    expect(germany.evidence.map((item) => item.type)).toEqual(['ooni_only', 'ooni_blocked_on_few_networks']);
  });
});

describe('viewer country', () => {
  it('prefers the chosen country, then the proxy header, then GeoIP, then the default', () => {
    const resolve = createCountryResolver({ geoip, fallback: 'NL', trustCountryHeader: true });
    expect(resolve({ requested: 'de', ip: '5.62.0.1', headerCountry: 'IR' })).toEqual({ country: 'DE', source: 'chosen' });
    expect(resolve({ requested: 'auto', ip: '85.214.132.117', headerCountry: 'IR' })).toEqual({ country: 'IR', source: 'ip' });
    expect(resolve({ requested: 'auto', ip: '85.214.132.117', headerCountry: 'XX' })).toEqual({ country: 'DE', source: 'ip' });
    expect(resolve({ requested: undefined, ip: '127.0.0.1', headerCountry: undefined })).toEqual({ country: 'NL', source: 'default' });
    const untrusted = createCountryResolver({ geoip, fallback: 'NL', trustCountryHeader: false });
    expect(untrusted({ requested: undefined, ip: '127.0.0.1', headerCountry: 'IR' }).country).toBe('NL');
  });
});

describe('country routing', () => {
  it('answers from the VPN country with OONI data and keeps Netherlands on the probe', async () => {
    const server = await app();
    const germany = await server.inject({
      method: 'POST',
      url: '/api/v1/check',
      headers: { 'x-forwarded-for': '85.214.132.117' },
      payload: { domains: ['example.com'], country: 'auto' },
    });
    expect(germany.json()).toMatchObject({ country: 'DE', countrySource: 'ip', measuredBy: 'ooni', results: [{ status: 'accessible', country: 'DE' }] });
    const iran = await server.inject({ method: 'POST', url: '/api/v1/check', headers: { 'x-forwarded-for': '5.62.0.1' }, payload: { domains: ['example.com'] } });
    expect(iran.json()).toMatchObject({ country: 'IR', results: [{ status: 'blocked' }] });
    const home = await server.inject({ method: 'POST', url: '/api/v1/check', payload: { domains: ['example.com'], country: 'NL' } });
    expect(home.json()).toMatchObject({ country: 'NL', measuredBy: 'probe', results: [{ evidence: ['blockpage_detected'] }] });
    const where = await server.inject({ method: 'GET', url: '/api/v1/whereami', headers: { 'x-forwarded-for': '85.214.132.117' } });
    expect(where.json()).toEqual({ country: 'DE', source: 'ip', measuredBy: 'ooni' });
  });

  it('uses a probe in that country when one is configured and falls back to OONI when it fails', async () => {
    const peer = (fail: boolean): PeerClient => ({
      check: async (domains) => {
        if (fail) {
          throw new Error('down');
        }
        return (await local.check(domains)).map((result) => ({ ...result, country: 'DE', status: 'accessible', network: { isp: 'Telekom', asn: 'AS3320', city: 'Berlin' } }));
      },
      status: async () => ({ isp: 'Telekom', asn: 'AS3320', city: 'Berlin', online: !fail }),
    });
    const working = await app({ countryPeers: { DE: [peer(false)] } });
    const viaPeer = (await working.inject({ method: 'POST', url: '/api/v1/check', payload: { domains: ['example.com'], country: 'DE' } })).json();
    expect(viaPeer).toMatchObject({ measuredBy: 'peer', results: [{ network: { isp: 'Telekom' } }] });
    const broken = await app({ countryPeers: { DE: [peer(true)] } });
    const fallback = (await broken.inject({ method: 'POST', url: '/api/v1/check', payload: { domains: ['example.com'], country: 'DE' } })).json();
    expect(fallback).toMatchObject({ results: [{ network: { isp: 'OONI reports' }, status: 'accessible' }] });
  });

  it('only has history for the probe country', async () => {
    const server = await app();
    const other = (await server.inject({ method: 'GET', url: '/api/v1/history?domain=example.com&country=DE' })).json();
    expect(other).toMatchObject({ available: false });
  });
});

describe('website access', () => {
  it('allows only the configured website origin', async () => {
    const server = await buildApp({ service: local, network, ooniEnabled: true, persistence: false, rateLimitPerMinute: 100, corsOrigins: ['https://pkfilter.example'] });
    const allowed = await server.inject({ method: 'OPTIONS', url: '/api/v1/check', headers: { origin: 'https://pkfilter.example', 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type' } });
    expect(allowed.headers['access-control-allow-origin']).toBe('https://pkfilter.example');
    const other = await server.inject({ method: 'GET', url: '/api/v1/status', headers: { origin: 'https://evil.example' } });
    expect(other.headers['access-control-allow-origin']).toBeUndefined();
  });
});
