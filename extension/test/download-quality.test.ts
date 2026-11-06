import { afterEach, describe, expect, it, vi } from 'vitest';
import { planFromDash } from '../src/core/dash';
import { downloadChoices } from '../src/core/download-choices';
import { hlsQualities, parsePlaylist, type HlsMaster } from '../src/core/hls';
import { newStreamJob } from '../src/core/stream-jobs';
import type { MediaInfo } from '../src/core/types';

const BASE = 'https://cdn.example.com/show/master.m3u8';

const master = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=854x480,CODECS="avc1.4d401e,mp4a.40.2"
480.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=2500000,RESOLUTION=1280x720,CODECS="avc1.64001f,mp4a.40.2"
720.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=2000000,RESOLUTION=1280x720,CODECS="avc1.64001f,mp4a.40.2"
720-low.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080,CODECS="avc1.640028,mp4a.40.2"
1080.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=128000,CODECS="mp4a.40.2"
audio.m3u8`;

const info = (extra: Partial<MediaInfo>): MediaInfo => ({
  status: 'downloadable',
  url: BASE,
  extension: 'ts',
  mime: 'application/vnd.apple.mpegurl',
  sizeBytes: 1000,
  reason: 'HLS stream',
  ...extra,
});

describe('stream qualities', () => {
  it('lists every HLS height once, best first, with a size estimate', () => {
    const qualities = hlsQualities(parsePlaylist(master, BASE) as HlsMaster, 100);
    expect(qualities).toEqual([
      { height: 1080, sizeBytes: 62_500_000 },
      { height: 720, sizeBytes: 31_250_000 },
      { height: 480, sizeBytes: 10_000_000 },
    ]);
  });

  it('lists DASH heights and adds the separate audio to each size', () => {
    const mpd = `<MPD type="static" mediaPresentationDuration="PT100S"><Period>
      <AdaptationSet mimeType="video/mp4" contentType="video">
        <SegmentTemplate duration="4" media="$RepresentationID$/$Number$.m4v" initialization="$RepresentationID$/init.m4v"/>
        <Representation id="v720" codecs="avc1" bandwidth="2000000" width="1280" height="720"/>
        <Representation id="v1080" codecs="avc1" bandwidth="4000000" width="1920" height="1080"/>
      </AdaptationSet>
      <AdaptationSet mimeType="audio/mp4" contentType="audio">
        <SegmentTemplate duration="4" media="a/$Number$.m4a" initialization="a/init.m4a"/>
        <Representation id="a" codecs="mp4a.40.2" bandwidth="160000"/>
      </AdaptationSet></Period></MPD>`;
    expect(planFromDash(mpd, 'https://cdn.example.com/show/manifest.mpd').qualities).toEqual([
      { height: 1080, sizeBytes: 52_000_000 },
      { height: 720, sizeBytes: 27_000_000 },
    ]);
  });

  it('offers a choice only when there is more than one option', () => {
    const choices = downloadChoices(info({ qualities: [{ height: 1080, sizeBytes: 62_500_000 }, { height: 720, sizeBytes: null }], audioOnly: true }));
    expect(choices.map((choice) => [choice.label, choice.maxHeight, choice.audioOnly])).toEqual([
      ['1080p', 1080, undefined],
      ['720p', 720, undefined],
      ['Audio only', undefined, true],
    ]);
    expect(choices[0]?.detail).toMatch(/^~\d/);
    expect(choices[1]?.detail).toBe('');
    expect(downloadChoices(info({ qualities: [{ height: 720, sizeBytes: null }] }))).toEqual([]);
    expect(downloadChoices(info({}))).toEqual([]);
  });

  it('remembers the picked quality on the job so retry keeps it', () => {
    const plan = { manifestUrl: BASE, tracks: [], combine: false, durationSeconds: 1, estimatedBytes: null, resolution: null };
    expect(newStreamJob('a', plan, 'Clip', BASE, new Date(), false, 720).maxHeight).toBe(720);
    expect(newStreamJob('b', plan, 'Clip', BASE, new Date()).maxHeight).toBeUndefined();
  });
});

type Listener = (item: Partial<chrome.downloads.DownloadItem>, suggest: (value?: chrome.downloads.FilenameSuggestion) => void) => void;

describe('saved file names', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('keeps the video name and extension even when the browser ignores the filename option', async () => {
    const hooks: { listener: Listener | null } = { listener: null };
    vi.stubGlobal('chrome', {
      runtime: { id: 'self' },
      downloads: {
        download: async () => 7,
        onDeterminingFilename: { addListener: (next: Listener) => (hooks.listener = next) },
      },
    });
    const { saveFile } = await import('../src/background/download-names');
    await saveFile('blob:chrome-extension://self/1705179f', 'Evening news', 'ts');
    const ours = vi.fn();
    hooks.listener?.({ id: 7, url: 'blob:chrome-extension://self/1705179f', byExtensionId: 'self' }, ours);
    expect(ours).toHaveBeenCalledWith({ filename: 'Evening news.ts', conflictAction: 'uniquify' });

    const other = vi.fn();
    hooks.listener?.({ id: 8, url: 'https://example.com/report.pdf', byExtensionId: undefined }, other);
    expect(other).toHaveBeenCalledWith();
  });
});

describe('quality menu on the video icon', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.resetModules();
    document.body.innerHTML = '';
  });

  it('opens a quality list and downloads the picked height', async () => {
    const sent: Array<Record<string, unknown>> = [];
    vi.stubGlobal('chrome', {
      runtime: {
        id: 'self',
        sendMessage: async (message: Record<string, unknown>) => {
          sent.push(message);
          if (message.type === 'inspect-media') {
            return info({ qualities: [{ height: 1080, sizeBytes: 62_500_000 }, { height: 480, sizeBytes: 10_000_000 }] });
          }
          return { ok: true };
        },
      },
    });
    const roots: ShadowRoot[] = [];
    const attach = Element.prototype.attachShadow;
    vi.spyOn(Element.prototype, 'attachShadow').mockImplementation(function (this: Element, init: ShadowRootInit) {
      const root = attach.call(this, init);
      roots.push(root);
      return root;
    });
    const { createVideoButton } = await import('../src/content/video-button');
    const { prepareDownload } = await import('../src/content/video-actions');
    const button = createVideoButton('overlay');
    document.body.append(button.element);
    await prepareDownload(button, BASE, 'Evening news');
    const root = roots[0] as ShadowRoot;
    (root.querySelector('.main') as HTMLButtonElement).click();
    const rows = [...root.querySelectorAll<HTMLButtonElement>('.item')];
    expect(rows.map((row) => row.textContent)).toEqual(['1080p~60 MB', '480p~9.5 MB']);
    rows[1]?.click();
    await vi.waitFor(() => expect(sent.some((message) => message.type === 'download')).toBe(true));
    expect(sent.find((message) => message.type === 'download')).toMatchObject({ url: BASE, title: 'Evening news', maxHeight: 480 });
    expect(root.querySelector('.menu')?.hasAttribute('hidden')).toBe(true);
  });
});
