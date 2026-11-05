import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkSite, CheckError } from '../src/core/check-api';
import { checkView } from '../src/core/check-view';
import { domainFromInput } from '../src/core/domain-input';

const result = {
  domain: 'x.com',
  status: 'blocked',
  confidence: 0.9,
  country: 'PK',
  lastChecked: new Date().toISOString(),
  evidence: ['blockpage_detected'],
  method: 'probe',
  network: { isp: 'PTCL', asn: 'AS17557', city: 'Karachi' },
  ttlSeconds: 900,
  networks: [
    { isp: 'PTCL', asn: 'AS17557', city: 'Karachi', status: 'blocked', confidence: 0.9, lastChecked: '', evidence: [] },
    { isp: 'Jazz', asn: 'AS1', city: 'Lahore', status: 'accessible', confidence: 0.9, lastChecked: '', evidence: [] },
  ],
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('domainFromInput', () => {
  it('accepts domains and links and rejects everything else', () => {
    expect(domainFromInput('  https://www.Example.com/path?q=1 ')).toBe('example.com');
    expect(domainFromInput('dawn.com.pk')).toBe('dawn.com.pk');
    expect(domainFromInput('localhost')).toBeNull();
    expect(domainFromInput('javascript:alert(1)')).toBeNull();
    expect(domainFromInput('')).toBeNull();
  });
});

describe('checkSite', () => {
  it('sends the country and reads the answer', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ results: [result], country: 'PK', countrySource: 'ip', measuredBy: 'probe' })));
    vi.stubGlobal('fetch', fetchMock);
    const check = await checkSite('x.com', 'auto');
    expect(JSON.parse(String((fetchMock.mock.calls[0] as unknown[])[1] && ((fetchMock.mock.calls[0] as unknown[])[1] as RequestInit).body))).toEqual({ domains: ['x.com'], country: 'auto' });
    expect(check).toMatchObject({ country: 'PK', countrySource: 'ip', measuredBy: 'probe', result: { status: 'blocked' } });
  });

  it('explains rate limits and outages', async () => {
    vi.stubGlobal('fetch', async () => new Response('slow down', { status: 429 }));
    await expect(checkSite('x.com', 'auto')).rejects.toThrow('Too many checks');
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('offline');
    });
    await expect(checkSite('x.com', 'auto')).rejects.toBeInstanceOf(CheckError);
  });
});

describe('checkView', () => {
  it('summarises the result with networks, evidence and archive links', () => {
    const view = checkView({ domain: 'x.com', country: 'PK', countrySource: 'ip', measuredBy: 'probe', result: result as never });
    expect(view?.headline).toBe('x.com in Pakistan');
    expect(view?.status.label).toBe('Blocked');
    expect(view?.facts.find((fact) => fact.label === 'Country')?.value).toBe('Pakistan (from your IP address)');
    expect(view?.networks.map((network) => `${network.isp}:${network.label}`)).toEqual(['PTCL:Blocked', 'Jazz:Accessible']);
    expect(view?.links.map((link) => link.label)).toEqual(['Open archived copy', 'See OONI evidence']);
    expect(checkView({ domain: 'x.com', country: 'PK', countrySource: 'ip', measuredBy: 'probe', result: null })).toBeNull();
  });
});
