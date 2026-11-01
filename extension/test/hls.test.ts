import { describe, expect, it, vi } from 'vitest';
import { toStreamView } from '../src/core/downloads';
import { estimateBytes, matchesStreamDomain, parsePlaylist, pickVariant, streamProblem, trackExtension, type HlsMaster, type HlsMedia } from '../src/core/hls';
import { runSegments, SegmentError, type SegmentChunk } from '../src/core/segment-pipeline';
import { parseStreamDomain, sanitizeSettings } from '../src/core/settings';
import { newStreamJob } from '../src/core/stream-jobs';

const BASE = 'https://cdn.example.com/show/master.m3u8';

const master = `#EXTM3U
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="English",DEFAULT=YES,URI="audio/en.m3u8"
#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360
low/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080,AUDIO="aud"
hd/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=2500000,RESOLUTION=1280x720,CODECS="avc1.64001f,mp4a.40.2"
mid/index.m3u8`;

const media = (extra = '', ending = '#EXT-X-ENDLIST') => `#EXTM3U
#EXT-X-TARGETDURATION:10
${extra}
#EXTINF:10.0,
seg0.ts
#EXTINF:9.5,
seg1.ts
${ending}`;

describe('parsePlaylist', () => {
  it('reads master playlists with audio groups and quoted commas', () => {
    const parsed = parsePlaylist(master, BASE) as HlsMaster;
    expect(parsed.kind).toBe('master');
    expect(parsed.variants).toHaveLength(3);
    expect(parsed.variants[1]).toMatchObject({ uri: 'https://cdn.example.com/show/hd/index.m3u8', bandwidth: 5000000, audioUri: 'https://cdn.example.com/show/audio/en.m3u8' });
    expect(parsed.variants[2]?.resolution).toBe('1280x720');
  });

  it('prefers the best quality that has audio muxed in', () => {
    expect(pickVariant(parsePlaylist(master, BASE) as HlsMaster)?.uri).toBe('https://cdn.example.com/show/mid/index.m3u8');
    const onlySeparate = parsePlaylist(master.replace(/#EXT-X-STREAM-INF:BANDWIDTH=(800000|2500000)[^\n]*\n[^\n]*\n?/g, ''), BASE) as HlsMaster;
    expect(pickVariant(onlySeparate)?.audioUri).toBe('https://cdn.example.com/show/audio/en.m3u8');
  });

  it('reads media playlists and flags what cannot be downloaded', () => {
    const vod = parsePlaylist(media(), 'https://cdn.example.com/show/hd/index.m3u8') as HlsMedia;
    expect(vod).toMatchObject({ kind: 'media', live: false, encrypted: false, durationSeconds: 19.5 });
    expect(vod.segments.map((segment) => segment.url)).toEqual(['https://cdn.example.com/show/hd/seg0.ts', 'https://cdn.example.com/show/hd/seg1.ts']);
    expect(streamProblem(vod)).toBeNull();
    expect(streamProblem(parsePlaylist(media('', ''), BASE) as HlsMedia)).toBe('Live streams cannot be downloaded');
    expect(streamProblem(parsePlaylist(media('#EXT-X-KEY:METHOD=AES-128,URI="key.bin"'), BASE) as HlsMedia)).toContain('encrypted');
    expect(streamProblem(parsePlaylist(media('#EXT-X-KEY:METHOD=NONE'), BASE) as HlsMedia)).toBeNull();
    expect(parsePlaylist('<html>', BASE)).toBeNull();
  });

  it('picks the right file type and drops unsafe segment hosts', () => {
    const fmp4 = parsePlaylist(media('#EXT-X-MAP:URI="init.mp4"').replace(/\.ts/g, '.m4s'), BASE) as HlsMedia;
    expect(fmp4.init?.url).toBe('https://cdn.example.com/show/init.mp4');
    expect(trackExtension(fmp4, 'video')).toBe('mp4');
    expect(trackExtension(fmp4, 'audio')).toBe('m4a');
    expect(trackExtension(parsePlaylist(media(), BASE) as HlsMedia, 'video')).toBe('ts');
    const unsafe = parsePlaylist(media().replace('seg1.ts', 'http://192.168.1.5/seg1.ts'), BASE) as HlsMedia;
    expect(unsafe.segments.map((segment) => segment.url)).toEqual(['https://cdn.example.com/show/seg0.ts']);
    expect(estimateBytes(8_000_000, 10)).toBe(10_000_000);
  });
});

describe('byte-range streams', () => {
  it('turns EXT-X-BYTERANGE into exact ranges, continuing offsets in the same file', () => {
    const text = `#EXTM3U
#EXT-X-MAP:URI="main.mp4",BYTERANGE="720@0"
#EXTINF:6.0,
#EXT-X-BYTERANGE:1000@720
main.mp4
#EXTINF:6.0,
#EXT-X-BYTERANGE:500
main.mp4
#EXTINF:6.0,
#EXT-X-BYTERANGE:300@0
other.mp4
#EXT-X-ENDLIST`;
    const parsed = parsePlaylist(text, BASE) as HlsMedia;
    expect(parsed.init).toEqual({ url: 'https://cdn.example.com/show/main.mp4', range: { start: 0, end: 719 } });
    expect(parsed.segments.map((segment) => segment.range)).toEqual([
      { start: 720, end: 1719 },
      { start: 1720, end: 2219 },
      { start: 0, end: 299 },
    ]);
    expect(streamProblem(parsed)).toBeNull();
    expect(trackExtension(parsed, 'video')).toBe('mp4');
  });
});

describe('stream domains', () => {
  it('matches only allowlisted sites and their subdomains', () => {
    expect(matchesStreamDomain('www.mysite.com', ['mysite.com'])).toBe(true);
    expect(matchesStreamDomain('videos.mysite.com', ['mysite.com'])).toBe(true);
    expect(matchesStreamDomain('notmysite.com', ['mysite.com'])).toBe(false);
    expect(matchesStreamDomain('mysite.com.evil.io', ['mysite.com'])).toBe(false);
    expect(matchesStreamDomain('mysite.com', [])).toBe(false);
  });

  it('normalises what people type and sanitises stored lists', () => {
    expect(parseStreamDomain('https://www.MySite.com/videos?x=1')).toBe('mysite.com');
    expect(parseStreamDomain('learn.example.org')).toBe('learn.example.org');
    expect(parseStreamDomain('not a domain')).toBeNull();
    expect(sanitizeSettings({ streamDomains: ['a.com', 'www.a.com', 'bad', 42, 'b.org'] }).streamDomains).toEqual(['a.com', 'b.org']);
  });
});

describe('runSegments', () => {
  const chunk = (text: string): SegmentChunk => new TextEncoder().encode(text) as SegmentChunk;
  const base = () => ({
    concurrency: 3,
    attempts: 3,
    signal: new AbortController().signal,
    waitIfPaused: async () => undefined,
    onSegment: vi.fn(),
    delay: async () => undefined,
  });

  it('writes segments in order even when they finish out of order', async () => {
    const written: string[] = [];
    let running = 0;
    let peak = 0;
    await runSegments({
      ...base(),
      items: ['a', 'b', 'c', 'd', 'e'],
      fetchSegment: async (url) => {
        running += 1;
        peak = Math.max(peak, running);
        await new Promise((resolve) => setTimeout(resolve, url === 'a' ? 30 : 5));
        running -= 1;
        return chunk(url);
      },
      write: async (data) => void written.push(new TextDecoder().decode(data)),
    });
    expect(written).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(peak).toBeLessThanOrEqual(3);
  });

  it('retries flaky segments but stops on permanent errors', async () => {
    let calls = 0;
    await runSegments({
      ...base(),
      items: ['x'],
      fetchSegment: async () => {
        calls += 1;
        if (calls < 3) throw new Error('network');
        return chunk('ok');
      },
      write: async () => undefined,
    });
    expect(calls).toBe(3);

    let forbidden = 0;
    await expect(
      runSegments({
        ...base(),
        items: ['y'],
        fetchSegment: async () => {
          forbidden += 1;
          throw new SegmentError('Stream segment returned 403', false);
        },
        write: async () => undefined,
      }),
    ).rejects.toThrow('403');
    expect(forbidden).toBe(1);
  });

  it('waits while paused and stops when cancelled', async () => {
    const controller = new AbortController();
    let release: () => void = () => undefined;
    let paused = true;
    const written: string[] = [];
    const run = runSegments({
      ...base(),
      items: ['a', 'b'],
      signal: controller.signal,
      waitIfPaused: () => (paused ? new Promise<void>((resolve) => (release = resolve)) : Promise.resolve()),
      fetchSegment: async (url) => chunk(url),
      write: async (data) => {
        written.push(new TextDecoder().decode(data));
        controller.abort();
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(written).toEqual([]);
    paused = false;
    release();
    await expect(run).rejects.toThrow('Cancelled');
    expect(written).toEqual(['a']);
  });
});

describe('stream jobs in the downloads list', () => {
  it('shows progress, saving and completion', () => {
    const segments = ['1', '2', '3', '4'].map((name) => ({ url: `https://cdn.example.com/${name}.ts`, range: null }));
    const plan = { manifestUrl: BASE, tracks: [{ kind: 'video' as const, extension: 'ts', init: null, segments }], durationSeconds: 40, estimatedBytes: 4000, resolution: '1280x720' };
    const job = newStreamJob('job-1', plan, 'Lecture 1', 'https://learn.example.org/v/1', new Date('2026-11-01T00:00:00Z'));
    expect(job).toMatchObject({ total: 4, state: 'downloading', extension: 'ts' });
    expect(toStreamView({ ...job, done: 2 })).toMatchObject({ kind: 'stream', streamId: 'job-1', state: 'in_progress', percent: 50 });
    expect(toStreamView({ ...job, state: 'saving' }).percent).toBe(100);
    expect(toStreamView({ ...job, state: 'complete', downloadIds: [5], bytes: 3900 })).toMatchObject({ state: 'complete', fileExists: true, totalBytes: 3900 });
    expect(toStreamView({ ...job, state: 'failed', error: 'Stream segment returned 403' }).error).toBe('Stream segment returned 403');
  });
});
