import { beforeEach, describe, expect, it } from 'vitest';
import { alternativesFor, archiveUrl, evidenceUrl, needsAlternatives } from '../src/core/alternatives';
import { domainFromBingHref } from '../src/core/domain';
import { effectiveResult } from '../src/core/networks';
import { sanitizeSettings } from '../src/core/settings';
import { siteCardView, siteDomainFromUrl } from '../src/core/site-view';
import type { CheckResult, NetworkResult } from '../src/core/types';
import { claimResults } from '../src/content/result-detector';
import { bingEngine, duckDuckGoEngine, engineFor, googleEngine } from '../src/content/search-engines';

const network = (isp: string, status: NetworkResult['status']): NetworkResult => ({ isp, asn: `AS-${isp}`, city: 'x', status, confidence: 0.9, lastChecked: '2026-11-05T10:00:00Z', evidence: [`${isp}_${status}`] });

const result = (fields: Partial<CheckResult> = {}): CheckResult => ({
  domain: 'example.net',
  status: 'possibly_blocked',
  confidence: 0.6,
  country: 'NL',
  lastChecked: '2026-11-05T10:00:00Z',
  evidence: ['blocked_on_some_networks'],
  method: 'probe',
  network: { isp: 'NetOne', asn: 'AS-NetOne', city: 'Capital City' },
  ttlSeconds: 600,
  networks: [network('NetOne', 'blocked'), network('NetTwo', 'accessible')],
  ...fields,
});

describe('per-network results', () => {
  it('follows the chosen ISP and falls back to the combined result', () => {
    expect(effectiveResult(result(), '').status).toBe('possibly_blocked');
    expect(effectiveResult(result(), 'NetOne')).toMatchObject({ status: 'blocked', network: { isp: 'NetOne' } });
    expect(effectiveResult(result(), 'NetTwo').status).toBe('accessible');
    expect(effectiveResult(result(), 'NetThree').status).toBe('possibly_blocked');
    expect(effectiveResult(result({ networks: undefined }), 'NetOne').status).toBe('possibly_blocked');
  });

  it('keeps the preferred ISP in settings', () => {
    expect(sanitizeSettings({ preferredIsp: ' NetTwo ' }).preferredIsp).toBe('NetTwo');
    expect(sanitizeSettings({ preferredIsp: 42 }).preferredIsp).toBe('');
  });
});

describe('site card', () => {
  const now = Date.parse('2026-11-05T12:00:00Z');

  it('summarises status, networks, history and alternatives', () => {
    const view = siteCardView(
      { domain: 'example.net', result: result(), history: { available: true, days: [{ day: '2026-11-04', status: 'blocked' }, { day: '2026-11-05', status: 'blocked' }], blockedSince: '2026-11-04' } },
      '',
      now,
    );
    expect(view?.status.label).toBe('Blocked on some ISPs');
    expect(view?.checked).toBe('Checked 2 hours ago · Netherlands · NetOne · AS-NetOne');
    expect(view?.networks.map((chip) => `${chip.isp}:${chip.label}`)).toEqual(['NetOne:Blocked', 'NetTwo:Accessible']);
    expect(view?.history).toHaveLength(30);
    expect(view?.history?.at(-1)).toMatchObject({ day: '2026-11-05', title: '2026-11-05: Blocked' });
    expect(view?.history?.[0]?.title).toBe('2026-10-07: Not checked');
    expect(view?.blockedSince).toBe('2026-11-04');
    expect(view?.alternatives.map((link) => link.label)).toEqual(['Open archived copy', 'See OONI evidence']);
  });

  it('stays minimal for a single accessible network without history', () => {
    const view = siteCardView({ domain: 'newsdaily.org', result: result({ domain: 'newsdaily.org', status: 'accessible', evidence: [], networks: undefined }), history: { available: false, days: [], blockedSince: null } }, '', now);
    expect(view).toMatchObject({ status: { label: 'Accessible' }, networks: [], history: null, alternatives: [] });
    expect(siteCardView({ domain: 'x.com', result: null, history: null }, '', now)).toBeNull();
  });

  it('only reads web pages from the active tab', () => {
    expect(siteDomainFromUrl('https://www.newsdaily.org/news/1')).toBe('www.newsdaily.org');
    expect(siteDomainFromUrl('chrome://extensions')).toBeNull();
    expect(siteDomainFromUrl(undefined)).toBeNull();
  });

  it('builds safe alternative links', () => {
    expect(needsAlternatives('blocked')).toBe(true);
    expect(needsAlternatives('accessible')).toBe(false);
    expect(archiveUrl('example.net')).toBe('https://web.archive.org/web/2/https://example.net/');
    expect(new URL(evidenceUrl('example.net', 'DE')).searchParams.get('probe_cc')).toBe('DE');
    expect(alternativesFor('example.net', 'NL')).toHaveLength(2);
  });
});

describe('search engines', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('picks the engine from the page host', () => {
    expect(engineFor('www.google.de')).toBe(googleEngine);
    expect(engineFor('google.co.uk')).toBe(googleEngine);
    expect(engineFor('google.evil.com')).toBeNull();
    expect(engineFor('www.bing.com')).toBe(bingEngine);
    expect(engineFor('duckduckgo.com')).toBe(duckDuckGoEngine);
    expect(engineFor('example.com')).toBeNull();
  });

  it('decodes Bing redirect links', () => {
    expect(domainFromBingHref('https://www.bing.com/ck/a?!&&p=abc&u=a1aHR0cHM6Ly93d3cubmV3c2RhaWx5Lm9yZy8&ntb=1', 'https://www.bing.com')).toBe('newsdaily.org');
    expect(domainFromBingHref('https://example.com/?u=a1aHR0cHM6Ly93d3cubmV3c2RhaWx5Lm9yZy8', 'https://www.bing.com')).toBeNull();
    expect(domainFromBingHref('https://www.bing.com/ck/a?u=garbage', 'https://www.bing.com')).toBeNull();
  });

  it('finds Bing organic results and skips ads and answers', () => {
    document.body.innerHTML = `
      <ol id="b_results">
        <li class="b_algo"><h2><a href="https://www.bing.com/ck/a?!&&u=a1aHR0cHM6Ly93d3cubmV3c2RhaWx5Lm9yZy8">Home - News Daily</a></h2><cite>https://www.newsdaily.org</cite></li>
        <li class="b_algo"><h2><a href="https://www.bing.com/ck/a?!&&p=zzz">Epaper</a></h2><cite>https://epaper.newsdaily.org › page</cite></li>
        <li class="b_ans"><h2><a href="https://www.bing.com/videos">Videos</a></h2></li>
        <li class="b_ad"><ul><li class="b_algo"><h2><a href="https://ads.example.com">Ad</a></h2></li></ul></li>
      </ol>`;
    const results = claimResults(document, 'https://www.bing.com', bingEngine);
    expect(results.map((item) => item.domain)).toEqual(['newsdaily.org', 'epaper.newsdaily.org']);
    expect(results[0]?.heading.tagName).toBe('H2');
    expect(results[0]?.container.className).toBe('b_algo');
  });

  it('finds DuckDuckGo results and hides the whole list item', () => {
    document.body.innerHTML = `
      <ol class="react-results--main">
        <li data-layout="organic"><article data-testid="result"><h2><a data-testid="result-title-a" href="https://www.newsdaily.org/">Home - News Daily</a></h2></article></li>
        <li data-layout="ad"><article data-testid="ad"><h2><a href="https://ads.example.com">Ad</a></h2></article></li>
      </ol>`;
    const results = claimResults(document, 'https://duckduckgo.com', duckDuckGoEngine);
    expect(results.map((item) => item.domain)).toEqual(['newsdaily.org']);
    expect(results[0]?.container.tagName).toBe('LI');
  });
});
