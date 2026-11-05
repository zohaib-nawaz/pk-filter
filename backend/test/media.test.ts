import { Readable } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';

interface FakeResource {
  status?: number;
  type: string;
  body: string | Buffer;
  needsReferer?: string;
  failures?: number;
}

const web = new Map<string, FakeResource>();
const seenReferers: Array<string | undefined> = [];

vi.mock('../src/services/media/safe-http.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/services/media/safe-http.js')>();
  const openSafe = async (url: string, options: { range?: { start: number; end: number | null }; referer?: string } = {}) => {
    const resource = web.get(url);
    seenReferers.push(options.referer);
    if (!resource || (resource.needsReferer && options.referer !== resource.needsReferer)) {
      return { status: resource ? 403 : 404, headers: {}, finalUrl: url, body: Readable.from([]) };
    }
    if (resource.failures && resource.failures > 0) {
      resource.failures -= 1;
      return { status: 503, headers: {}, finalUrl: url, body: Readable.from([]) };
    }
    const bytes = Buffer.isBuffer(resource.body) ? resource.body : Buffer.from(resource.body);
    const slice = options.range ? bytes.subarray(options.range.start, options.range.end === null ? undefined : options.range.end + 1) : bytes;
    return {
      status: options.range ? 206 : resource.status || 200,
      headers: {
        'content-type': resource.type,
        'content-length': String(slice.length),
        'accept-ranges': 'bytes',
        etag: '"v1"',
        ...(options.range ? { 'content-range': `bytes ${options.range.start}-${options.range.start + slice.length - 1}/${bytes.length}` } : {}),
      },
      finalUrl: url,
      body: Readable.from([slice]),
    };
  };
  const fetchText = async (url: string, maxBytes: number, options: { referer?: string } = {}) => {
    const response = await openSafe(url, options);
    actual.expectOk(response as never);
    return { text: (await actual.readBody(response as never, maxBytes)).toString('utf8'), finalUrl: url };
  };
  const fetchBytes = async (url: string, maxBytes: number, options: { range?: { start: number; end: number | null }; referer?: string } = {}) => {
    const response = await openSafe(url, options);
    actual.expectOk(response as never);
    return new Uint8Array(await actual.readBody(response as never, maxBytes));
  };
  return { ...actual, openSafe, fetchText, fetchBytes };
});

const { buildApp } = await import('../src/app.js');
const { inspectMediaUrl } = await import('../src/services/media/inspect.js');
const { pageMediaSources } = await import('../src/services/media/page-sources.js');
const { createDownloadSlots } = await import('../src/services/media/slots.js');
const { readTicket, signTicket } = await import('../src/services/media/token.js');

const SITE = 'https://media.example.org';
const SECRET = 'test-secret-that-is-long-enough-123456';

const masterPlaylist = (audio: boolean) => `#EXTM3U
${audio ? '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="en",DEFAULT=YES,URI="audio.m3u8"' : ''}
#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360${audio ? ',AUDIO="aud"' : ''}
360.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080${audio ? ',AUDIO="aud"' : ''}
1080.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=2500000,RESOLUTION=1280x720${audio ? ',AUDIO="aud"' : ''}
720.m3u8`;

const mediaPlaylist = (prefix: string, map = '') => `#EXTM3U
#EXT-X-TARGETDURATION:10
${map}
#EXTINF:10.0,
${prefix}0.ts
#EXTINF:10.0,
${prefix}1.ts
#EXT-X-ENDLIST`;

function serve(path: string, type: string, body: string | Buffer): void {
  web.set(`${SITE}${path}`, { type, body });
}

async function app() {
  return buildApp({
    service: { check: async () => [], drain: async () => undefined },
    network: { country: 'PK', isp: 'PTCL', asn: 'AS17557', city: 'Karachi' },
    ooniEnabled: false,
    persistence: false,
    rateLimitPerMinute: 100,
    media: { secret: SECRET, maxBytes: 1024 * 1024, ticketTtlMs: 60_000, slots: createDownloadSlots(4, 1) },
  });
}

beforeEach(() => {
  web.clear();
  seenReferers.length = 0;
});

async function formatsFor(server: Awaited<ReturnType<typeof app>>, url: string) {
  const response = await server.inject({ method: 'POST', url: '/api/v1/media/formats', payload: { url } });
  return response.json() as { title: string; formats: Array<{ label: string; token: string }> };
}

describe('page sources', () => {
  it('finds players, declared files, metadata and script URLs', () => {
    const html = `<meta property="og:video" content="https://cdn.example.org/og.mp4">
      <video data-download-url="/files/full.mp4" src="blob:https://x"></video>
      <source src="clip-720p.mp4" type="video/mp4">
      <script>{"contentUrl":"https:\\/\\/cdn.example.org\\/ld.mp4"}; player.load("https://cdn.example.org/hls/master.m3u8?token=a&amp;b=1")</script>`;
    expect(pageMediaSources(html, `${SITE}/watch/1`)).toEqual([
      `${SITE}/files/full.mp4`,
      `${SITE}/watch/clip-720p.mp4`,
      'https://cdn.example.org/og.mp4',
      'https://cdn.example.org/ld.mp4',
      'https://cdn.example.org/hls/master.m3u8?token=a&b=1',
    ]);
  });
});

describe('format inspection', () => {
  it('lists every HLS quality, highest first, with audio merged when possible', async () => {
    serve('/master.m3u8', 'application/vnd.apple.mpegurl', masterPlaylist(true));
    for (const name of ['360', '720', '1080']) {
      serve(`/${name}.m3u8`, 'application/vnd.apple.mpegurl', mediaPlaylist(`v${name}-`, '#EXT-X-MAP:URI="init.mp4"'));
    }
    serve('/audio.m3u8', 'application/vnd.apple.mpegurl', mediaPlaylist('a-', '#EXT-X-MAP:URI="ainit.mp4"'));
    const result = await inspectMediaUrl(`${SITE}/master.m3u8`);
    expect(result.source).toBe('hls');
    expect(result.durationSeconds).toBe(20);
    expect(result.formats.map((format) => [format.label, format.audio, format.container])).toEqual([
      ['1080p', 'included', 'mp4'],
      ['720p', 'included', 'mp4'],
      ['360p', 'included', 'mp4'],
      ['Audio only', 'only', 'm4a'],
    ]);
    expect(result.formats[0]?.sizeBytes).toBe(12_500_000);
  });

  it('marks TS qualities with separate audio as video only', async () => {
    serve('/master.m3u8', 'application/x-mpegurl', masterPlaylist(true));
    for (const name of ['360', '720', '1080', 'audio']) {
      serve(`/${name}.m3u8`, 'application/x-mpegurl', mediaPlaylist(`${name}-`));
    }
    const result = await inspectMediaUrl(`${SITE}/master.m3u8`);
    expect(result.formats[0]).toMatchObject({ label: '1080p', audio: 'none' });
    expect(result.formats[0]?.detail).toContain('video only');
  });

  it('finds the published file on a normal page', async () => {
    serve('/watch', 'text/html; charset=utf-8', '<title>Launch day</title><meta property="og:video" content="/v/launch-720p.mp4">');
    serve('/v/launch-720p.mp4', 'video/mp4', Buffer.alloc(2048));
    const result = await inspectMediaUrl(`${SITE}/watch`);
    expect(result).toMatchObject({ title: 'Launch day', source: 'page', formats: [{ label: '720p', sizeBytes: 2048, container: 'mp4' }] });
  });

  it('lists DASH video renditions and the audio track', async () => {
    serve(
      '/stream.mpd',
      'application/dash+xml',
      `<MPD type="static" mediaPresentationDuration="PT10S"><Period>
        <AdaptationSet contentType="video" mimeType="video/mp4"><SegmentTemplate duration="5" media="$RepresentationID$-$Number$.m4s" initialization="$RepresentationID$-init.mp4"/>
          <Representation id="hd" bandwidth="4000000" width="1920" height="1080"/><Representation id="sd" bandwidth="1000000" width="854" height="480"/></AdaptationSet>
        <AdaptationSet contentType="audio" mimeType="audio/mp4"><SegmentTemplate duration="5" media="a-$Number$.m4s" initialization="a-init.mp4"/><Representation id="a" bandwidth="128000" codecs="mp4a.40.2"/></AdaptationSet>
      </Period></MPD>`,
    );
    const result = await inspectMediaUrl(`${SITE}/stream.mpd`);
    expect(result.formats.map((format) => `${format.label}:${format.audio}`)).toEqual(['1080p:included', '480p:included', 'Audio only:only']);
  });

  it('refuses platforms that do not allow downloads', async () => {
    await expect(inspectMediaUrl('https://www.youtube.com/watch?v=abc')).rejects.toMatchObject({ reason: 'restricted' });
    await expect(inspectMediaUrl('https://m.facebook.com/watch/?v=1')).rejects.toMatchObject({ reason: 'restricted' });
  });
});

describe('media routes', () => {
  it('returns formats with signed tokens and streams the chosen one', async () => {
    serve('/clip.m3u8', 'application/vnd.apple.mpegurl', mediaPlaylist('seg'));
    serve('/seg0.ts', 'video/mp2t', 'AAAA');
    serve('/seg1.ts', 'video/mp2t', 'BBBB');
    const server = await app();
    const formats = await server.inject({ method: 'POST', url: '/api/v1/media/formats', payload: { url: `${SITE}/clip.m3u8` } });
    const body = formats.json() as { title: string; formats: Array<{ label: string; token: string }> };
    expect(body.formats).toHaveLength(1);
    expect(body.formats[0]).not.toHaveProperty('ref');
    const download = await server.inject({ method: 'GET', url: `/api/v1/media/download?t=${encodeURIComponent(body.formats[0]?.token as string)}` });
    expect(download.statusCode).toBe(200);
    expect(download.body).toBe('AAAABBBB');
    expect(download.headers['content-type']).toBe('video/mp2t');
    expect(download.headers['content-disposition']).toContain('clip.ts');
  });

  it('rejects tampered or expired links and explains refusals', async () => {
    const server = await app();
    const forged = signTicket({ ref: { kind: 'file', url: 'http://10.0.0.1/x.mp4', extension: 'mp4' }, title: 'x', exp: Date.now() + 1000 }, 'another-secret-that-is-long-enough-000');
    expect((await server.inject({ method: 'GET', url: `/api/v1/media/download?t=${forged}` })).statusCode).toBe(410);
    const expired = signTicket({ ref: { kind: 'file', url: `${SITE}/a.mp4`, extension: 'mp4' }, title: 'x', exp: Date.now() - 1 }, SECRET);
    expect(readTicket(expired, SECRET, Date.now())).toBeNull();
    const refused = await server.inject({ method: 'POST', url: '/api/v1/media/formats', payload: { url: 'https://youtu.be/abc' } });
    expect(refused.statusCode).toBe(403);
    const broken = await server.inject({ method: 'POST', url: '/api/v1/media/formats', payload: { url: 'https://not%20a%20link/' } });
    expect(broken.statusCode).toBe(400);
    const missing = await server.inject({ method: 'POST', url: '/api/v1/media/formats', payload: { url: `${SITE}/nothing.html` } });
    expect(missing.statusCode).toBe(422);
  });

  it('limits downloads per client', () => {
    const slots = createDownloadSlots(3, 1);
    const release = slots.take('a');
    expect(release).not.toBeNull();
    expect(slots.take('a')).toBeNull();
    expect(slots.take('b')).not.toBeNull();
    release?.();
    expect(slots.take('a')).not.toBeNull();
  });

  it('sends the page as referer, retries busy segments and names files by quality', async () => {
    serve('/watch', 'text/html', '<title>Team talk</title><script>load("https://media.example.org/hls/master.m3u8")</script>');
    serve('/hls/master.m3u8', 'application/vnd.apple.mpegurl', '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=1280x720\nv.m3u8');
    serve('/hls/v.m3u8', 'application/vnd.apple.mpegurl', mediaPlaylist('s'));
    web.set(`${SITE}/hls/s0.ts`, { type: 'video/mp2t', body: 'AAAA', needsReferer: `${SITE}/watch`, failures: 2 });
    web.set(`${SITE}/hls/s1.ts`, { type: 'video/mp2t', body: 'BBBB', needsReferer: `${SITE}/watch` });
    const server = await app();
    const found = await formatsFor(server, `${SITE}/watch`);
    expect(found.formats[0]?.label).toBe('720p');
    const download = await server.inject({ method: 'GET', url: `/api/v1/media/download?t=${encodeURIComponent(found.formats[0]?.token as string)}` });
    expect(download.body).toBe('AAAABBBB');
    expect(download.headers['content-disposition']).toContain('Team talk (720p).ts');
    expect(seenReferers).toContain(`${SITE}/watch`);
  });

  it('resumes direct files with byte ranges', async () => {
    serve('/files/movie.mp4', 'video/mp4', Buffer.from('0123456789'));
    const server = await app();
    const found = await formatsFor(server, `${SITE}/files/movie.mp4`);
    const token = encodeURIComponent(found.formats[0]?.token as string);
    expect(decodeURIComponent(token)).not.toContain('movie');
    const full = await server.inject({ method: 'GET', url: `/api/v1/media/download?t=${token}` });
    expect(full.headers['accept-ranges']).toBe('bytes');
    expect(full.headers.etag).toBe('"v1"');
    const resumed = await server.inject({ method: 'GET', url: `/api/v1/media/download?t=${token}`, headers: { range: 'bytes=4-' } });
    expect(resumed.statusCode).toBe(206);
    expect(resumed.body).toBe('456789');
    expect(resumed.headers['content-range']).toBe('bytes 4-9/10');
  });

  it('shows a readable page when a browser opens an expired link', async () => {
    const server = await app();
    const response = await server.inject({ method: 'GET', url: '/api/v1/media/download?t=expired-token.signature', headers: { accept: 'text/html,application/xhtml+xml' } });
    expect(response.statusCode).toBe(410);
    expect(response.headers['content-type']).toContain('text/html');
    expect(response.body).toContain('This download link has expired');
  });

  it('reports a failing first segment before any bytes are sent', async () => {
    serve('/broken.m3u8', 'application/vnd.apple.mpegurl', mediaPlaylist('gone'));
    const server = await app();
    const found = await formatsFor(server, `${SITE}/broken.m3u8`);
    const response = await server.inject({
      method: 'GET',
      url: `/api/v1/media/download?t=${encodeURIComponent(found.formats[0]?.token as string)}`,
      headers: { accept: 'text/html' },
    });
    expect(response.statusCode).toBe(422);
    expect(response.headers['content-type']).toContain('text/html');
    expect(response.headers['content-disposition']).toBeUndefined();
  });

  it('copes with odd file names and does not start downloads for HEAD requests', async () => {
    serve('/clip%E0%A4.mp4', 'video/mp4', Buffer.alloc(16));
    const server = await app();
    const found = await formatsFor(server, `${SITE}/clip%E0%A4.mp4`);
    expect(found.formats).toHaveLength(1);
    const head = await server.inject({ method: 'HEAD', url: `/api/v1/media/download?t=${encodeURIComponent(found.formats[0]?.token as string)}` });
    expect(head.statusCode).toBe(404);
  });

  it('returns a thumbnail and an inline preview for pages with a video file', async () => {
    serve('/show', 'text/html', '<title>Show</title><meta property="og:image" content="/img/cover.jpg"><video src="/v/show.mp4"></video>');
    serve('/img/cover.jpg', 'image/jpeg', Buffer.from([0xff, 0xd8, 0xff, 0xe0]));
    serve('/v/show.mp4', 'video/mp4', Buffer.from('0123456789'));
    const server = await app();
    const response = await server.inject({ method: 'POST', url: '/api/v1/media/formats', payload: { url: `${SITE}/show` } });
    const body = response.json() as { thumbnail: string; preview: { token: string; audioOnly: boolean } };
    expect(body.preview.audioOnly).toBe(false);
    const image = await server.inject({ method: 'GET', url: `/api/v1/media/thumbnail?t=${encodeURIComponent(body.thumbnail)}` });
    expect(image.statusCode).toBe(200);
    expect(image.headers['content-type']).toBe('image/jpeg');
    expect(image.rawPayload).toHaveLength(4);
    const preview = await server.inject({ method: 'GET', url: `/api/v1/media/preview?t=${encodeURIComponent(body.preview.token)}`, headers: { range: 'bytes=2-5' } });
    expect(preview.statusCode).toBe(206);
    expect(preview.body).toBe('2345');
    expect(preview.headers['content-disposition']).toMatch(/^inline;/);
    const misuse = await server.inject({ method: 'GET', url: `/api/v1/media/download?t=${encodeURIComponent(body.thumbnail)}` });
    expect(misuse.statusCode).toBe(410);
  });

  it('refuses thumbnails that are not images and has no preview for streams', async () => {
    serve('/page', 'text/html', '<meta property="og:image" content="/evil.svg"><script>x("https://media.example.org/s.m3u8")</script>');
    serve('/evil.svg', 'image/svg+xml', '<svg onload="alert(1)"/>');
    serve('/s.m3u8', 'application/vnd.apple.mpegurl', mediaPlaylist('p'));
    const server = await app();
    const body = (await server.inject({ method: 'POST', url: '/api/v1/media/formats', payload: { url: `${SITE}/page` } })).json() as { thumbnail: string; preview: unknown };
    expect(body.preview).toBeNull();
    const image = await server.inject({ method: 'GET', url: `/api/v1/media/thumbnail?t=${encodeURIComponent(body.thumbnail)}` });
    expect(image.statusCode).toBe(404);
  });
});
