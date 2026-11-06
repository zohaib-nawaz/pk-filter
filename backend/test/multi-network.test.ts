import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { nullRepository, type CheckRepository } from '../src/database/repository.js';
import type { AccessibilityService, CheckResult } from '../src/services/accessibility-service.js';
import type { AccessStatus } from '../src/services/classification-engine.js';
import { summarizeHistory } from '../src/services/history.js';
import { aggregateNetworks, type NetworkResult } from '../src/services/network-aggregate.js';
import type { PeerClient } from '../src/services/peer-client.js';

const network = { country: 'NL', isp: 'NetOne', asn: 'AS64500', city: 'Capital City' };

const result = (domain: string, status: AccessStatus, isp = 'NetOne', ttlSeconds = 1200): CheckResult => ({
  domain,
  status,
  confidence: status === 'blocked' ? 0.9 : 0.85,
  country: 'NL',
  lastChecked: '2026-11-05T00:00:00.000Z',
  evidence: [`${isp.toLowerCase()}_${status}`],
  method: 'probe',
  network: { isp, asn: `AS-${isp}`, city: 'x' },
  ttlSeconds,
});

const net = (status: AccessStatus, isp: string): NetworkResult => ({ isp, asn: 'AS', city: 'x', status, confidence: 0.9, lastChecked: '', evidence: [] });

const fixed = (map: Record<string, AccessStatus>, isp = 'NetOne'): AccessibilityService => ({
  check: async (domains) => domains.map((domain) => result(domain, map[domain] ?? 'unknown', isp)),
  drain: async () => undefined,
});

const peer = (map: Record<string, AccessStatus>, isp: string, fail = false): PeerClient => ({
  check: async (domains) => {
    if (fail) {
      throw new Error('peer down');
    }
    return domains.map((domain) => result(domain, map[domain] ?? 'unknown', isp, 600));
  },
  status: async () => ({ isp, asn: `AS-${isp}`, city: 'River City', online: !fail }),
});

describe('aggregateNetworks', () => {
  it('keeps a single network exactly as measured', () => {
    expect(aggregateNetworks([{ ...net('possibly_blocked', 'NetOne'), confidence: 0.55, evidence: ['dns_control_mismatch'] }])).toEqual({ status: 'possibly_blocked', confidence: 0.55, evidence: ['dns_control_mismatch'] });
  });

  it('only calls a site blocked when every measured network blocks it', () => {
    expect(aggregateNetworks([net('blocked', 'NetOne'), net('blocked', 'NetTwo'), net('unknown', 'NetThree')]).status).toBe('blocked');
    const mixed = aggregateNetworks([net('blocked', 'NetOne'), net('accessible', 'NetTwo')]);
    expect(mixed.status).toBe('possibly_blocked');
    expect(mixed.evidence[0]).toBe('blocked_on_some_networks');
    expect(aggregateNetworks([net('accessible', 'NetOne'), net('server_error', 'NetTwo')]).status).toBe('accessible');
    expect(aggregateNetworks([net('unknown', 'NetOne'), net('unknown', 'NetTwo')]).status).toBe('unknown');
  });
});

describe('summarizeHistory', () => {
  it('keeps the worst status per day and finds the current blocking streak', () => {
    const summary = summarizeHistory([
      { day: '2026-11-01', status: 'accessible', lastAt: '2026-11-01T10:00:00.000' },
      { day: '2026-11-02', status: 'accessible', lastAt: '2026-11-02T08:00:00.000' },
      { day: '2026-11-02', status: 'blocked', lastAt: '2026-11-02T20:00:00.000' },
      { day: '2026-11-03', status: 'blocked', lastAt: '2026-11-03T10:00:00.000' },
    ]);
    expect(summary.days).toEqual([
      { day: '2026-11-01', status: 'accessible' },
      { day: '2026-11-02', status: 'blocked' },
      { day: '2026-11-03', status: 'blocked' },
    ]);
    expect(summary.blockedSince).toBe('2026-11-02');
    expect(summarizeHistory([{ day: '2026-11-03', status: 'accessible', lastAt: '2026-11-03T10:00:00.000' }]).blockedSince).toBeNull();
  });

  it('ends the streak on a day that was blocked early but accessible later', () => {
    const summary = summarizeHistory([
      { day: '2026-11-02', status: 'blocked', lastAt: '2026-11-02T08:00:00.000' },
      { day: '2026-11-02', status: 'accessible', lastAt: '2026-11-02T20:00:00.000' },
      { day: '2026-11-03', status: 'blocked', lastAt: '2026-11-03T10:00:00.000' },
    ]);
    expect(summary.days.map((item) => item.status)).toEqual(['blocked', 'blocked']);
    expect(summary.blockedSince).toBe('2026-11-03');
  });
});

async function app(options: { peers?: PeerClient[]; probeToken?: string; repository?: CheckRepository }) {
  return buildApp({
    service: fixed({ 'newsdaily.org': 'accessible', 'blocked.com': 'blocked' }),
    network,
    ooniEnabled: false,
    persistence: false,
    rateLimitPerMinute: 100,
    ...options,
  });
}

describe('multi-network API', () => {
  it('adds per-network results and survives a failing peer', async () => {
    const server = await app({ peers: [peer({ 'newsdaily.org': 'accessible', 'blocked.com': 'accessible' }, 'NetTwo'), peer({}, 'NetThree', true)] });
    const response = await server.inject({ method: 'POST', url: '/api/v1/check', payload: { domains: ['newsdaily.org', 'blocked.com'] } });
    const body = response.json() as { results: CheckResult[] };
    const blocked = body.results.find((item) => item.domain === 'blocked.com');
    expect(blocked?.status).toBe('possibly_blocked');
    expect(blocked?.networks?.map((item) => `${item.isp}:${item.status}`)).toEqual(['NetOne:blocked', 'NetTwo:accessible']);
    expect(blocked?.ttlSeconds).toBe(600);
    expect(body.results.find((item) => item.domain === 'newsdaily.org')?.status).toBe('accessible');
    const status = (await server.inject({ method: 'GET', url: '/api/v1/status' })).json() as { networks: Array<{ isp: string; online: boolean }> };
    expect(status.networks.map((item) => `${item.isp}:${item.online}`)).toEqual(['NetOne:true', 'NetTwo:true', 'NetThree:false']);
  });

  it('works exactly as before without peers', async () => {
    const server = await app({});
    const body = (await server.inject({ method: 'POST', url: '/api/v1/check', payload: { domains: ['blocked.com'] } })).json() as { results: CheckResult[] };
    expect(body.results[0]).toMatchObject({ status: 'blocked', confidence: 0.9 });
    expect(body.results[0]?.networks).toBeUndefined();
  });

  it('only answers peer probes with the right token', async () => {
    expect((await (await app({})).inject({ method: 'POST', url: '/api/v1/probe', payload: { domains: ['newsdaily.org'] } })).statusCode).toBe(404);
    const server = await app({ probeToken: 'secret-token' });
    const denied = await server.inject({ method: 'POST', url: '/api/v1/probe', headers: { 'x-probe-token': 'nope' }, payload: { domains: ['newsdaily.org'] } });
    expect(denied.statusCode).toBe(401);
    const allowed = await server.inject({ method: 'POST', url: '/api/v1/probe', headers: { 'x-probe-token': 'secret-token' }, payload: { domains: ['www.newsdaily.org'] } });
    expect(allowed.json()).toMatchObject({ results: [{ domain: 'newsdaily.org', status: 'accessible' }] });
  });

  it('reports history only when the database is available', async () => {
    const without = (await (await app({})).inject({ method: 'GET', url: '/api/v1/history?domain=newsdaily.org' })).json();
    expect(without).toMatchObject({ domain: 'newsdaily.org', available: false, days: [] });
    const repository: CheckRepository = { ...nullRepository, history: async () => [{ day: '2026-11-04', status: 'blocked', lastAt: '2026-11-04T10:00:00.000' }] };
    const withDb = (await (await app({ repository })).inject({ method: 'GET', url: '/api/v1/history?domain=https://www.newsdaily.org/x' })).json();
    expect(withDb).toMatchObject({ domain: 'newsdaily.org', available: true, blockedSince: '2026-11-04' });
    expect((await (await app({})).inject({ method: 'GET', url: '/api/v1/history?domain=localhost' })).statusCode).toBe(400);
  });
});
