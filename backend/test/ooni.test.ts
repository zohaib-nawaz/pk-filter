import { describe, expect, it, vi } from 'vitest';
import { createOoniService, summarizeOoni, type OoniRow } from '../src/services/ooni-service.js';

const NOW = Date.parse('2026-11-01T12:00:00Z');

const row = (day: string, asn: number, fields: Partial<OoniRow>): OoniRow => ({
  measurement_start_day: day,
  probe_asn: asn,
  measurement_count: 0,
  anomaly_count: 0,
  confirmed_count: 0,
  failure_count: 0,
  ok_count: 0,
  ...fields,
});

describe('summarizeOoni', () => {
  it('splits recent from historical measurements and groups by network', () => {
    const summary = summarizeOoni(
      [
        row('2026-10-01', 9541, { measurement_count: 4, confirmed_count: 4, anomaly_count: 4 }),
        row('2026-10-30', 9541, { measurement_count: 3, ok_count: 3 }),
        row('2026-10-31T08:00:00Z', 64500, { measurement_count: 2, anomaly_count: 2 }),
      ],
      NOW,
    );
    expect(summary.total.measurements).toBe(9);
    expect(summary.total.confirmed).toBe(4);
    expect(summary.recent).toEqual({ measurements: 5, anomalies: 2, confirmed: 0, failures: 0, ok: 3 });
    expect(summary.networks.map((n) => n.asn)).toEqual(['AS9541', 'AS64500']);
    expect(summary.lastMeasuredDay).toBe('2026-10-31');
  });
});

describe('createOoniService', () => {
  it('queries apex and www, caches results, and backs off on failure', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ result: [row('2026-10-31', 1, { measurement_count: 1, ok_count: 1 })] })));
    const service = createOoniService({ baseUrl: 'https://api.ooni.io', country: 'NL', enabled: true, fetchFn, now: () => NOW });
    const first = await service.summary('example.com');
    await service.summary('example.com');
    expect(first?.recent.measurements).toBe(2);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    const url = new URL(String((fetchFn.mock.calls[0] as unknown[])[0]));
    expect(url.searchParams.get('probe_cc')).toBe('NL');
    expect(url.searchParams.get('domain')).toBe('example.com');

    const failing = vi.fn(async () => new Response('busy', { status: 429 }));
    const throttled = createOoniService({ baseUrl: 'https://api.ooni.io', country: 'NL', enabled: true, fetchFn: failing, now: () => NOW });
    expect(await throttled.summary('a.com')).toBeNull();
    expect(await throttled.summary('b.com')).toBeNull();
    expect(failing).toHaveBeenCalledTimes(2);
  });

  it('returns null when disabled', async () => {
    const fetchFn = vi.fn();
    const service = createOoniService({ baseUrl: 'https://api.ooni.io', country: 'NL', enabled: false, fetchFn });
    expect(await service.summary('example.com')).toBeNull();
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
