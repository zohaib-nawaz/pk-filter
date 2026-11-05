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
  domain: 'example.pk',
  status: 'possibly_blocked',
  confidence: 0.6,
  country: 'PK',
  lastChecked: '2026-11-05T10:00:00Z',
  evidence: ['blocked_on_some_networks'],
  method: 'probe',
  network: { isp: 'PTCL', asn: 'AS-PTCL', city: 'Karachi' },
  ttlSeconds: 600,
  networks: [network('PTCL', 'blocked'), network('Jazz', 'accessible')],
  ...fields,
});

describe('per-network results', () => {
  it('follows the chosen ISP and falls back to the combined result', () => {
    expect(effectiveResult(result(), '').status).toBe('possibly_blocked');
    expect(effectiveResult(result(), 'PTCL')).toMatchObject({ status: 'blocked', network: { isp: 'PTCL' } });
    expect(effectiveResult(result(), 'Jazz').status).toBe('accessible');
    expect(effectiveResult(result(), 'Zong').status).toBe('possibly_blocked');
    expect(effectiveResult(result({ networks: undefined }), 'PTCL').status).toBe('possibly_blocked');
  });

  it('keeps the preferred ISP in settings', () => {
    expect(sanitizeSettings({ preferredIsp: ' Jazz ' }).preferredIsp).toBe('Jazz');
    expect(sanitizeSettings({ preferredIsp: 42 }).preferredIsp).toBe('');
  });
});

describe('site card', () => {
  const now = Date.parse('2026-11-05T12:00:00Z');

  it('summarises status, networks, history and alternatives', () => {
    const view = siteCardView(
      { domain: 'example.pk', result: result(), history: { available: true, days: [{ day: '2026-11-04', status: 'blocked' }, { day: '2026-11-05', status: 'blocked' }], blockedSince: '2026-11-04' } },
      '',
      now,
    );
    expect(view?.status.label).toBe('Blocked on some ISPs');
    expect(view?.checked).toBe('Checked 2 hours ago · Pakistan · PTCL · AS-PTCL');
    expect(view?.networks.map((chip) => `${chip.isp}:${chip.label}`)).toEqual(['PTCL:Blocked', 'Jazz:Accessible']);
    expect(view?.history).toHaveLength(30);
    expect(view?.history?.at(-1)).toMatchObject({ day: '2026-11-05', title: '2026-11-05: Blocked' });
    expect(view?.history?.[0]?.title).toBe('2026-10-07: Not checked');
    expect(view?.blockedSince).toBe('2026-11-04');
    expect(view?.alternatives.map((link) => link.label)).toEqual(['Open archived copy', 'See OONI evidence']);
  });

  it('stays minimal for a single accessible network without history', () => {
    const view = siteCardView({ domain: 'dawn.com', result: result({ domain: 'dawn.com', status: 'accessible', evidence: [], networks: undefined }), history: { available: false, days: [], blockedSince: null } }, '', now);
    expect(view).toMatchObject({ status: { label: 'Accessible' }, networks: [], history: null, alternatives: [] });
    expect(siteCardView({ domain: 'x.com', result: null, history: null }, '', now)).toBeNull();
  });

  it('only reads web pages from the active tab', () => {
    expect(siteDomainFromUrl('https://www.dawn.com/news/1')).toBe('www.dawn.com');
    expect(siteDomainFromUrl('chrome://extensions')).toBeNull();
    expect(siteDomainFromUrl(undefined)).toBeNull();
  });

  it('builds safe alternative links', () => {
    expect(needsAlternatives('blocked')).toBe(true);
    expect(needsAlternatives('accessible')).toBe(false);
    expect(archiveUrl('example.pk')).toBe('https://web.archive.org/web/2/https://example.pk/');
    expect(new URL(evidenceUrl('example.pk', 'DE')).searchParams.get('probe_cc')).toBe('DE');
    expect(alternativesFor('example.pk', 'PK')).toHaveLength(2);
  });
});

describe('search engines', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('picks the engine from the page host', () => {
    expect(engineFor('www.google.com.pk')).toBe(googleEngine);
    expect(engineFor('www.bing.com')).toBe(bingEngine);
    expect(engineFor('duckduckgo.com')).toBe(duckDuckGoEngine);
    expect(engineFor('example.com')).toBeNull();
  });

  it('decodes Bing redirect links', () => {
    expect(domainFromBingHref('https://www.bing.com/ck/a?!&&p=abc&u=a1aHR0cHM6Ly93d3cuZGF3bi5jb20v&ntb=1', 'https://www.bing.com')).toBe('dawn.com');
    expect(domainFromBingHref('https://example.com/?u=a1aHR0cHM6Ly93d3cuZGF3bi5jb20v', 'https://www.bing.com')).toBeNull();
    expect(domainFromBingHref('https://www.bing.com/ck/a?u=garbage', 'https://www.bing.com')).toBeNull();
  });

  it('finds Bing organic results and skips ads and answers', () => {
    document.body.innerHTML = `
      <ol id="b_results">
        <li class="b_algo"><h2><a href="https://www.bing.com/ck/a?!&&u=a1aHR0cHM6Ly93d3cuZGF3bi5jb20v">Home - DAWN</a></h2><cite>https://www.dawn.com</cite></li>
        <li class="b_algo"><h2><a href="https://www.bing.com/ck/a?!&&p=zzz">Epaper</a></h2><cite>https://epaper.dawn.com › page</cite></li>
        <li class="b_ans"><h2><a href="https://www.bing.com/videos">Videos</a></h2></li>
        <li class="b_ad"><ul><li class="b_algo"><h2><a href="https://ads.example.com">Ad</a></h2></li></ul></li>
      </ol>`;
    const results = claimResults(document, 'https://www.bing.com', bingEngine);
    expect(results.map((item) => item.domain)).toEqual(['dawn.com', 'epaper.dawn.com']);
    expect(results[0]?.heading.tagName).toBe('H2');
    expect(results[0]?.container.className).toBe('b_algo');
  });

  it('finds DuckDuckGo results and hides the whole list item', () => {
    document.body.innerHTML = `
      <ol class="react-results--main">
        <li data-layout="organic"><article data-testid="result"><h2><a data-testid="result-title-a" href="https://www.dawn.com/">Home - DAWN</a></h2></article></li>
        <li data-layout="ad"><article data-testid="ad"><h2><a href="https://ads.example.com">Ad</a></h2></article></li>
      </ol>`;
    const results = claimResults(document, 'https://duckduckgo.com', duckDuckGoEngine);
    expect(results.map((item) => item.domain)).toEqual(['dawn.com']);
    expect(results[0]?.container.tagName).toBe('LI');
  });
});
