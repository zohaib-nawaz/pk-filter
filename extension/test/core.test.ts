import { describe, expect, it } from 'vitest';
import { backoffDelay, chunk, expiresAt } from '../src/core/cache-policy';
import { domainFromDisplayedUrl, domainFromHref, domainFromSiteName, normalizeDomain } from '../src/core/domain';
import { isHidden } from '../src/core/filter';
import { DEFAULT_SETTINGS, sanitizeSettings } from '../src/core/settings';
import type { CheckResult, DisplayStatus, Settings } from '../src/core/types';

const BASE = 'https://www.google.com';

describe('domain extraction', () => {
  it('reads direct, redirect and displayed urls', () => {
    expect(domainFromHref('https://www.Example.com/a', BASE)).toBe('example.com');
    expect(domainFromHref('/url?q=https://news.ycombinator.com/item&sa=U', BASE)).toBe('news.ycombinator.com');
    expect(domainFromHref('/goto?url=CAESagHrOzAV', BASE)).toBeNull();
    expect(domainFromHref('https://maps.google.com/x', BASE)).toBeNull();
    expect(domainFromDisplayedUrl('https://en.wikipedia.org › wiki › Netherlands')).toBe('en.wikipedia.org');
    expect(domainFromDisplayedUrl('1.7K+ views · 9 years ago')).toBeNull();
    expect(domainFromSiteName('YouTube · DW News')).toBe('youtube.com');
    expect(domainFromSiteName('Some Blog')).toBeNull();
  });

  it('rejects invalid hosts', () => {
    expect(normalizeDomain('localhost')).toBeNull();
    expect(normalizeDomain('192.168.1.1')).toBeNull();
    expect(normalizeDomain('WWW.NewsDaily.org')).toBe('newsdaily.org');
  });
});

describe('isHidden', () => {
  const settings = (patch: Partial<Settings>): Settings => ({ ...DEFAULT_SETTINGS, ...patch });
  const statuses: DisplayStatus[] = ['accessible', 'blocked', 'possibly_blocked', 'unknown', 'server_error', 'checking'];
  const hiddenFor = (patch: Partial<Settings>) => statuses.filter((status) => isHidden(status, settings(patch)));

  it('hides nothing by default', () => {
    expect(hiddenFor({})).toEqual([]);
    expect(hiddenFor({ enabled: false, filterMode: 'only_accessible' })).toEqual([]);
  });

  it('hides only confirmed blocks in hide_blocked mode and keeps uncertain results', () => {
    expect(hiddenFor({ filterMode: 'hide_blocked' })).toEqual(['blocked']);
  });

  it('shows only accessible results when asked', () => {
    expect(hiddenFor({ filterMode: 'only_accessible' })).toEqual(['blocked', 'possibly_blocked']);
    expect(hiddenFor({ filterMode: 'only_accessible', showUnknown: false })).toEqual(['blocked', 'possibly_blocked', 'unknown', 'server_error']);
  });
});

describe('settings and cache policy', () => {
  it('sanitizes stored settings', () => {
    expect(sanitizeSettings({ filterMode: 'nope', minCacheMinutes: 7, enabled: 'yes' })).toEqual(DEFAULT_SETTINGS);
    expect(sanitizeSettings({ filterMode: 'hide_blocked', minCacheMinutes: 60 })).toMatchObject({ filterMode: 'hide_blocked', minCacheMinutes: 60 });
  });

  it('respects server ttl, user minimum and never stretches unknown', () => {
    const result = { status: 'accessible', ttlSeconds: 1200 } as CheckResult;
    expect(expiresAt(result, DEFAULT_SETTINGS, 0)).toBe(1_200_000);
    expect(expiresAt(result, { ...DEFAULT_SETTINGS, minCacheMinutes: 60 }, 0)).toBe(3_600_000);
    expect(expiresAt({ ...result, status: 'unknown', ttlSeconds: 300 }, { ...DEFAULT_SETTINGS, minCacheMinutes: 60 }, 0)).toBe(300_000);
  });

  it('backs off exponentially with a cap and chunks batches', () => {
    expect([1, 2, 3, 10].map(backoffDelay)).toEqual([5000, 10000, 20000, 300000]);
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });
});
