import { describe, expect, it } from 'vitest';
import { describeInterrupt, formatBytes } from '../src/core/download-errors';
import { countActive, progressPercent, toDownloadView } from '../src/core/downloads';
import { buildFilename, titleFromUrl } from '../src/core/filename';
import { classifyMediaResponse, looksLikeDuration, safeHttpUrl, sourceKind } from '../src/core/media';
import type { DownloadRecord } from '../src/core/types';

const response = (fields: Partial<Parameters<typeof classifyMediaResponse>[0]>) =>
  classifyMediaResponse({ status: 200, url: 'https://cdn.example.com/clip.mp4', contentType: 'video/mp4', contentLength: '1048576', contentRange: null, ...fields });

describe('safeHttpUrl', () => {
  it('allows public http(s) only', () => {
    expect(safeHttpUrl('https://cdn.example.com/a.mp4')?.hostname).toBe('cdn.example.com');
    for (const url of ['http://localhost/a.mp4', 'http://127.0.0.1/a.mp4', 'http://192.168.1.5/a.mp4', 'http://10.0.0.1/x', 'http://169.254.169.254/', 'http://[::1]/a.mp4', 'http://nas.local/a.mp4', 'http://intranet/a.mp4', 'ftp://example.com/a.mp4', 'javascript:alert(1)', 'https://user:pw@example.com/a.mp4']) {
      expect(safeHttpUrl(url), url).toBeNull();
    }
  });
});

describe('sourceKind', () => {
  it('separates direct files, streams and blobs', () => {
    expect(sourceKind('https://x.com/v/clip.MP4?token=1')).toBe('direct');
    expect(sourceKind('https://x.com/v/clip.webm')).toBe('direct');
    expect(sourceKind('https://x.com/master.m3u8')).toBe('streaming');
    expect(sourceKind('https://x.com/manifest.mpd')).toBe('streaming');
    expect(sourceKind('blob:https://www.youtube.com/abc')).toBe('blob');
    expect(sourceKind('https://x.com/watch?v=1')).toBe('unknown');
    expect(sourceKind('/media/a.mov', 'https://site.org/page')).toBe('direct');
    expect(sourceKind('http://localhost/a.mp4')).toBe('invalid');
  });

  it('recognises video durations', () => {
    expect(looksLikeDuration('10:02')).toBe(true);
    expect(looksLikeDuration('1:02:33')).toBe(true);
    expect(looksLikeDuration('Updated 10 days ago')).toBe(false);
  });
});

describe('classifyMediaResponse', () => {
  it('accepts real video responses with size', () => {
    expect(response({})).toMatchObject({ status: 'downloadable', extension: 'mp4', sizeBytes: 1048576 });
    expect(response({ contentType: 'video/webm', url: 'https://cdn.example.com/stream' })).toMatchObject({ status: 'downloadable', extension: 'webm' });
    expect(response({ status: 206, contentLength: '1', contentRange: 'bytes 0-0/52428800' }).sizeBytes).toBe(52428800);
    expect(response({ contentType: 'application/octet-stream', url: 'https://cdn.example.com/a.mov' })).toMatchObject({ status: 'downloadable', extension: 'mov' });
  });

  it('never claims non-video or failing links are downloadable', () => {
    expect(response({ contentType: 'text/html; charset=utf-8' }).status).toBe('unsupported');
    expect(response({ contentType: 'application/vnd.apple.mpegurl' }).status).toBe('streaming');
    expect(response({ contentType: 'video/x-unknown-codec' }).status).toBe('unsupported');
    expect(response({ contentType: 'application/octet-stream', url: 'https://cdn.example.com/file.bin' }).status).toBe('unsupported');
    expect(response({ status: 403 })).toMatchObject({ status: 'unavailable', reason: 'Access denied or the link has expired' });
    expect(response({ status: 404 }).status).toBe('unavailable');
    expect(response({ status: 503 }).reason).toBe('The video server returned an error');
    expect(response({ url: 'http://192.168.0.10/a.mp4' }).status).toBe('unsupported');
  });
});

describe('filenames', () => {
  it('sanitizes titles and keeps the extension', () => {
    expect(buildFilename('My <Video>: part 1/2?', 'mp4')).toBe('My Video part 1 2.mp4');
    expect(buildFilename('../../etc/passwd', 'webm')).toBe('etc passwd.webm');
    const emojiName = buildFilename(`${'a'.repeat(119)}😀 tail`, 'mp4');
    expect(() => encodeURIComponent(emojiName)).not.toThrow();
    expect(emojiName).toBe(`${'a'.repeat(119)}😀.mp4`);
    expect(buildFilename('clip.mp4', 'MP4')).toBe('clip.mp4');
    expect(buildFilename('   ', 'mov')).toBe('video.mov');
    expect(buildFilename('CON', 'mp4')).toBe('video.mp4');
    expect(buildFilename('a'.repeat(300), 'mp4')).toHaveLength(124);
    expect(titleFromUrl('https://x.com/media/Big%20Buck.mp4?x=1')).toBe('Big Buck');
  });
});

describe('download views', () => {
  const record: DownloadRecord = { id: 7, url: 'https://x.com/a.mp4', title: 'A', extension: 'mp4', sizeBytes: 1000, startedAt: '2026-11-01T00:00:00Z' };
  const item = { state: 'in_progress', paused: false, bytesReceived: 250, totalBytes: 1000, canResume: true, exists: true };

  it('maps chrome download states', () => {
    expect(toDownloadView(record, item).state).toBe('in_progress');
    expect(progressPercent(toDownloadView(record, item))).toBe(25);
    expect(toDownloadView(record, { ...item, paused: true }).state).toBe('paused');
    expect(toDownloadView(record, { ...item, state: 'interrupted', error: 'USER_CANCELED' }).state).toBe('cancelled');
    expect(toDownloadView(record, { ...item, state: 'interrupted', error: 'FILE_NO_SPACE' })).toMatchObject({ state: 'interrupted', error: 'Not enough disk space' });
    expect(toDownloadView(record, undefined).state).toBe('missing');
    expect(countActive([toDownloadView(record, item), toDownloadView(record, { ...item, state: 'complete' })])).toBe(1);
  });

  it('formats errors and sizes', () => {
    expect(describeInterrupt('SERVER_FORBIDDEN')).toBe('Access denied or the link has expired');
    expect(describeInterrupt('SOMETHING_NEW')).toBe('Download failed');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(null)).toBe('Unknown size');
  });
});

describe('video icon visibility', () => {
  it('shows only useful icons unless grey icons are enabled', async () => {
    const { isVideoButtonShown } = await import('../src/core/video-visibility');
    expect(['idle', 'checking', 'unavailable'].map((state) => isVideoButtonShown(state as 'idle', false))).toEqual([false, false, false]);
    expect(['ready', 'starting', 'started', 'error'].map((state) => isVideoButtonShown(state as 'ready', false))).toEqual([true, true, true, true]);
    expect(isVideoButtonShown('unavailable', true)).toBe(true);
    expect(isVideoButtonShown('idle', true)).toBe(false);
  });
});

describe('wider media formats', () => {
  it('accepts common video and audio types, including aliases', () => {
    expect(response({ contentType: 'video/x-matroska', url: 'https://cdn.example.com/a' })).toMatchObject({ status: 'downloadable', extension: 'mkv' });
    expect(response({ contentType: 'video/avi' }).extension).toBe('avi');
    expect(response({ contentType: 'audio/mpeg' }).extension).toBe('mp3');
    expect(response({ contentType: 'audio/x-m4a' }).extension).toBe('m4a');
    expect(response({ contentType: 'audio/wave' }).extension).toBe('wav');
    expect(response({ contentType: 'video/mp2t' }).extension).toBe('ts');
    expect(response({ contentType: 'application/octet-stream', url: 'https://cdn.example.com/song.flac' }).extension).toBe('flac');
    expect(sourceKind('https://x.com/a/podcast.mp3')).toBe('direct');
  });

  it('keeps TypeScript-looking links out of link scanning', async () => {
    const { MEDIA_LINK_EXTENSIONS } = await import('../src/core/media');
    expect(MEDIA_LINK_EXTENSIONS).toContain('mkv');
    expect(MEDIA_LINK_EXTENSIONS).not.toContain('ts');
  });
});

describe('mediaUrlsFromJsonLd', () => {
  it('finds contentUrl on video and audio objects, including nested graphs', async () => {
    const { mediaUrlsFromJsonLd } = await import('../src/core/page-metadata');
    const page = JSON.stringify({
      '@context': 'https://schema.org',
      '@graph': [
        { '@type': 'WebPage', name: 'x' },
        { '@type': 'VideoObject', contentUrl: 'https://cdn.example.com/v.mp4', embedUrl: 'https://player.example.com/1' },
        { '@type': ['Thing', 'AudioObject'], contentUrl: 'https://cdn.example.com/a.mp3' },
      ],
    });
    expect(mediaUrlsFromJsonLd(page).sort()).toEqual(['https://cdn.example.com/a.mp3', 'https://cdn.example.com/v.mp4']);
    expect(mediaUrlsFromJsonLd('{not json')).toEqual([]);
    expect(mediaUrlsFromJsonLd(JSON.stringify({ '@type': 'Article', contentUrl: 'https://x.com/a.mp4' }))).toEqual([]);
  });
});

describe('sniffMediaType', () => {
  const bytes = (...parts: Array<string | number[]>) =>
    new Uint8Array(parts.flatMap((part) => (typeof part === 'string' ? [...part].map((char) => char.charCodeAt(0)) : part)));

  it('recognises common video and audio files from their first bytes', async () => {
    const { sniffMediaType } = await import('../src/core/media');
    expect(sniffMediaType(bytes([0, 0, 0, 0x20], 'ftypisom'))).toBe('video/mp4');
    expect(sniffMediaType(bytes([0, 0, 0, 0x20], 'ftypqt  '))).toBe('video/quicktime');
    expect(sniffMediaType(bytes([0, 0, 0, 0x20], 'ftypM4A '))).toBe('audio/mp4');
    expect(sniffMediaType(bytes([0, 0, 0, 0x20], 'ftyp3gp4'))).toBe('video/3gpp');
    expect(sniffMediaType(bytes([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x82, 0x84], 'webm'))).toBe('video/webm');
    expect(sniffMediaType(bytes([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x82, 0x88], 'matroska'))).toBe('video/x-matroska');
    expect(sniffMediaType(bytes('ID3', [4, 0]))).toBe('audio/mpeg');
    expect(sniffMediaType(bytes([0xff, 0xfb, 0x90, 0x00]))).toBe('audio/mpeg');
    expect(sniffMediaType(bytes([0xff, 0xf1, 0x50, 0x80]))).toBe('audio/aac');
    expect(sniffMediaType(bytes('OggS'))).toBe('audio/ogg');
    expect(sniffMediaType(bytes('fLaC'))).toBe('audio/flac');
    expect(sniffMediaType(bytes('RIFF', [0, 0, 0, 0], 'WAVE'))).toBe('audio/wav');
    expect(sniffMediaType(bytes('RIFF', [0, 0, 0, 0], 'AVI '))).toBe('video/x-msvideo');
    expect(sniffMediaType(bytes('FLV', [1]))).toBe('video/x-flv');
    const ts = new Uint8Array(192);
    ts[0] = 0x47;
    ts[188] = 0x47;
    expect(sniffMediaType(ts)).toBe('video/mp2t');
  });

  it('does not mistake web pages or empty bodies for media', async () => {
    const { sniffMediaType } = await import('../src/core/media');
    expect(sniffMediaType(bytes('<!doctype html><html>'))).toBeNull();
    expect(sniffMediaType(bytes('{"ok":true}'))).toBeNull();
    expect(sniffMediaType(new Uint8Array())).toBeNull();
  });

  it('trusts the file bytes when the server reports a wrong or generic type', () => {
    expect(response({ contentType: 'text/html', url: 'https://cdn.example.com/watch/123', sniffed: 'video/mp4', contentRange: 'bytes 0-191/4000000' })).toMatchObject({ status: 'downloadable', extension: 'mp4', sizeBytes: 4000000 });
    expect(response({ contentType: 'application/octet-stream', url: 'https://cdn.example.com/file', sniffed: 'video/webm' })).toMatchObject({ status: 'downloadable', extension: 'webm' });
    expect(response({ contentType: 'text/html', url: 'https://cdn.example.com/page', sniffed: null }).status).toBe('unsupported');
    expect(response({ contentType: 'video/mp4', sniffed: 'audio/mpeg' }).extension).toBe('mp4');
  });
});
