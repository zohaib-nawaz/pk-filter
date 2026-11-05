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

describe('video lookup', () => {
  it('turns formats into rows with sound labels, sizes and download links', async () => {
    const { formatRows, lookupSummary, lookupVideo } = await import('../src/core/media-api');
    vi.stubGlobal('fetch', async () =>
      new Response(
        JSON.stringify({
          title: 'Launch',
          source: 'hls',
          durationSeconds: 125,
          formats: [
            { label: '1080p', detail: '1920x1080 · 5.0 Mbps · MP4', height: 1080, sizeBytes: 78_125_000, exactSize: false, container: 'mp4', audio: 'included', token: 'abc' },
            { label: 'Audio only', detail: 'M4A', height: null, sizeBytes: null, exactSize: false, container: 'm4a', audio: 'only', token: 'def' },
          ],
          thumbnail: 'thumb-token',
          preview: null,
        }),
      ),
    );
    const lookup = await lookupVideo('https://example.com/v');
    expect(lookupSummary(lookup)).toBe('HLS stream · 2:05 · 2 formats');
    const rows = formatRows(lookup);
    expect(rows[0]).toMatchObject({ label: '1080p', size: 'about 75 MB', audio: { text: 'With sound' } });
    expect(rows[0]?.href).toBe('http://localhost:8787/api/v1/media/download?t=abc');
    expect(rows[1]).toMatchObject({ size: 'Size unknown', audio: { text: 'Audio only' } });
    expect(lookup.preview).toEqual({ thumbnailUrl: 'http://localhost:8787/api/v1/media/thumbnail?t=thumb-token', mediaUrl: null, audioOnly: false });
  });

  it('shows the server reason when a site is refused', async () => {
    const { lookupVideo } = await import('../src/core/media-api');
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ error: 'restricted', message: 'This website does not allow downloads, so it is not supported' }), { status: 403 }));
    await expect(lookupVideo('https://youtube.com/watch?v=1')).rejects.toThrow('does not allow downloads');
  });
});

describe('checker refusals', () => {
  it('explains names the service will not check', async () => {
    const { checkSite } = await import('../src/core/check-api');
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ results: [], rejected: ['foo.local'], country: 'PK', countrySource: 'chosen', measuredBy: 'probe' })));
    await expect(checkSite('foo.local', 'PK')).rejects.toThrow('does not look like a public website');
  });
});
