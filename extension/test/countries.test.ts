import { afterEach, describe, expect, it, vi } from 'vitest';
import { countryName, isCountryCode } from '../src/core/countries';
import { mergeLocalCheck } from '../src/core/local-check';
import { sanitizeSettings } from '../src/core/settings';
import { verdictFor } from '../src/core/site-view';
import type { CheckResult } from '../src/core/types';

const result = (status: CheckResult['status']): CheckResult => ({
  domain: 'example.com',
  status,
  confidence: 0.7,
  country: 'DE',
  lastChecked: '2026-11-05T00:00:00.000Z',
  evidence: ['ooni_only'],
  method: 'OONI',
  network: { isp: 'OONI reports', asn: 'unknown', city: 'unknown' },
  ttlSeconds: 600,
});

describe('countries', () => {
  it('knows country codes and names', () => {
    expect(isCountryCode('DE')).toBe(true);
    expect(isCountryCode('XX')).toBe(false);
    expect(countryName('PK')).toBe('Pakistan');
    expect(countryName(null)).toBe('your country');
  });

  it('keeps auto or a real country in settings', () => {
    expect(sanitizeSettings({}).country).toBe('auto');
    expect(sanitizeSettings({ country: 'DE' }).country).toBe('DE');
    expect(sanitizeSettings({ country: 'Narnia' }).country).toBe('auto');
    expect(sanitizeSettings({}).localCheck).toBe(true);
    expect(sanitizeSettings({ localCheck: false }).localCheck).toBe(false);
  });

  it('words verdicts for the measured country', () => {
    expect(verdictFor('blocked', 'IR')).toContain('blocked in Iran');
    expect(verdictFor('accessible', 'DE')).toContain('opens from Germany');
  });
});

describe('own connection check', () => {
  it('trusts the browser when the site opens and adds weight when it fails', () => {
    expect(mergeLocalCheck(result('unknown'), 'reachable')).toMatchObject({ status: 'accessible', localCheck: 'reachable', evidence: ['opens_on_your_connection', 'ooni_only'] });
    expect(mergeLocalCheck(result('blocked'), 'reachable').status).toBe('accessible');
    expect(mergeLocalCheck(result('server_error'), 'reachable').status).toBe('server_error');
    expect(mergeLocalCheck(result('blocked'), 'failed')).toMatchObject({ status: 'blocked', confidence: 0.9 });
    expect(mergeLocalCheck(result('accessible'), 'failed')).toMatchObject({ status: 'possibly_blocked', evidence: ['fails_on_your_connection', 'ooni_only'] });
  });
});

describe('checker follows the viewer country', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('asks for the detected country, caches per country and rechecks when it changes', async () => {
    const local: Record<string, unknown> = {};
    let where = 'DE';
    const posted: string[] = [];
    vi.stubGlobal('__API_URL__', 'https://api.example.org');
    vi.stubGlobal('chrome', {
      storage: {
        local: {
          get: async (keys: string | string[] | null) => {
            if (keys === null) {
              return { ...local };
            }
            const list = Array.isArray(keys) ? keys : [keys];
            return Object.fromEntries(list.map((key) => [key, local[key]]));
          },
          set: async (items: Record<string, unknown>) => Object.assign(local, items),
          remove: async () => undefined,
        },
        sync: { get: async () => ({ settings: { country: 'auto', localCheck: false } }) },
      },
    });
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      if (url.includes('/whereami')) {
        return new Response(JSON.stringify({ country: where, source: 'ip', measuredBy: 'ooni' }));
      }
      const body = JSON.parse(String(init?.body)) as { domains: string[]; country: string };
      posted.push(body.country);
      return new Response(JSON.stringify({ country: body.country, results: body.domains.map((domain) => ({ ...result('accessible'), domain, country: body.country })) }));
    });
    const { checkDomains, lookupCached } = await import('../src/background/checker');
    const viewer = await import('../src/background/viewer');
    const first = await checkDomains(['example.com']);
    expect(first['example.com']?.country).toBe('DE');
    expect(posted).toEqual(['DE']);
    expect(Object.keys(local).filter((key) => key.startsWith('cache:'))).toEqual(['cache:DE:example.com']);
    where = 'US';
    await viewer.currentViewer(true);
    expect(local.refreshRequestedAt).toBeTypeOf('number');
    expect(await lookupCached(['example.com'])).toEqual({});
    await checkDomains(['example.com']);
    expect(posted).toEqual(['DE', 'US']);
  });

  it('asks the browser for its country when the server only sees a local address', async () => {
    vi.stubGlobal('__API_URL__', 'http://localhost:8787');
    const local: Record<string, unknown> = {};
    vi.stubGlobal('chrome', {
      storage: {
        local: { get: async (key: string) => ({ [key]: local[key] }), set: async (items: Record<string, unknown>) => Object.assign(local, items) },
        sync: { get: async () => ({ settings: { country: 'auto' } }) },
      },
    });
    vi.stubGlobal('fetch', async (url: string) => {
      if (url.includes('cdn-cgi/trace')) {
        return new Response('fl=1\nip=203.0.113.9\nloc=GB\ncolo=LHR\n');
      }
      const country = new URL(url).searchParams.get('country');
      if (country === 'auto') {
        return new Response(JSON.stringify({ country: 'PK', source: 'default', measuredBy: 'probe' }));
      }
      return new Response(JSON.stringify({ country, source: 'chosen', measuredBy: 'ooni' }));
    });
    const { currentViewer } = await import('../src/background/viewer');
    expect(await currentViewer()).toEqual({ country: 'GB', source: 'ip', measuredBy: 'ooni' });
  });
});

describe('overview from an older service worker', () => {
  it('fills missing fields instead of crashing the pages', async () => {
    const { overviewFrom } = await import('../src/core/overview');
    const old = overviewFrom({ cachedDomains: 3, sync: { lastSync: null, lastError: null }, service: { online: true, country: 'PK', network: null, networks: [], ooni: true } });
    expect(old?.service.probeCountries).toEqual([]);
    expect(old?.viewer).toBeNull();
    expect(overviewFrom(null)).toBeNull();
    expect(overviewFrom({})?.service.networks).toEqual([]);
  });
});
