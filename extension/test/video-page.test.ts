import { afterEach, describe, expect, it, vi } from 'vitest';
import { brandId } from '../src/core/brand';

const VIDEO_TAG = brandId('video');
const TAKEOVER = brandId('video-takeover');

type Message = { type: string; url?: string; videos?: Array<{ url: string; title?: string }> };

function installChrome(messages: Message[], extra: Record<string, unknown> = {}) {
  const settings = { videoDownloader: true, videoOnPages: true, ...extra };
  vi.stubGlobal('chrome', {
    runtime: {
      id: 'test-extension',
      sendMessage: async (message: Message) => {
        messages.push(message);
        if (message.type !== 'inspect-media') {
          return { ok: true };
        }
        const path = message.url ? new URL(message.url).pathname : '';
        if (path.endsWith('.m3u8') || path.endsWith('.mpd')) {
          return { status: 'downloadable', url: message.url, extension: 'ts', mime: 'application/vnd.apple.mpegurl', sizeBytes: 5000, reason: 'HLS stream' };
        }
        const extension = /\.(mp4|mp3)$/.exec(message.url ?? '')?.[1];
        return extension
          ? { status: 'downloadable', url: message.url, extension, mime: 'video/mp4', sizeBytes: 1000, reason: 'Direct media file' }
          : { status: 'unsupported', url: message.url, extension: null, mime: null, sizeBytes: null, reason: 'Not a video' };
      },
    },
    storage: {
      sync: { get: async () => ({ settings }) },
      onChanged: { addListener: () => undefined, removeListener: () => undefined },
    },
  });
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(private readonly callback: (entries: Array<{ target: Element; isIntersecting: boolean }>) => void) {}
      observe(target: Element) {
        queueMicrotask(() => this.callback([{ target, isIntersecting: true }]));
      }
      unobserve() {}
      disconnect() {}
    },
  );
}

function retire() {
  const stub = globalThis as unknown as { chrome?: { runtime: { id?: string } } };
  if (stub.chrome) {
    stub.chrome.runtime.id = undefined;
  }
  document.dispatchEvent(new CustomEvent(TAKEOVER));
}

afterEach(() => {
  retire();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('video page detection', () => {
  it('reports only downloadable videos, deduplicated, for the icon badge', async () => {
    document.head.innerHTML = '';
    document.body.innerHTML = `
      <video src="https://cdn.example.com/a.mp4"></video>
      <video src="https://cdn.example.com/a.mp4"></video>
      <video src="blob:https://www.facebook.com/123"></video>
      <video><source src="https://cdn.example.com/b.mp4" type="video/mp4"></video>
      <a href="https://cdn.example.com/c.mp4">Download clip</a>`;
    const messages: Message[] = [];
    installChrome(messages);
    await import('../src/content/video-page');
    await vi.waitFor(() => expect(messages.some((m) => m.type === 'page-videos')).toBe(true), { timeout: 2000 });
    const last = messages.filter((m) => m.type === 'page-videos').at(-1);
    expect(last?.videos?.map((video) => video.url).sort()).toEqual([
      'https://cdn.example.com/a.mp4',
      'https://cdn.example.com/b.mp4',
      'https://cdn.example.com/c.mp4',
    ]);
    expect(document.querySelectorAll(VIDEO_TAG)).toHaveLength(5);

    retire();
  });

  it("uses the page's published file for streamed players and detects audio", async () => {
    document.head.innerHTML = `
      <meta property="og:video" content="https://cdn.example.com/full.mp4">
      <script type="application/ld+json">{"@type":"VideoObject","contentUrl":"https://cdn.example.com/full.mp4"}</script>`;
    document.body.innerHTML = `
      <video src="blob:https://news.example.com/abc"></video>
      <audio src="https://cdn.example.com/episode.mp3" controls></audio>`;
    const messages: Message[] = [];
    installChrome(messages);
    await import('../src/content/video-page');
    await vi.waitFor(() => expect(messages.some((m) => m.type === 'page-videos')).toBe(true), { timeout: 2000 });
    const last = messages.filter((m) => m.type === 'page-videos').at(-1);
    expect(last?.videos?.map((video) => video.url).sort()).toEqual(['https://cdn.example.com/episode.mp3', 'https://cdn.example.com/full.mp4']);

    document.dispatchEvent(new CustomEvent(TAKEOVER));
    expect(document.querySelectorAll(VIDEO_TAG)).toHaveLength(2);
    retire();
    expect(document.querySelectorAll(VIDEO_TAG)).toHaveLength(0);
  });

  it('puts one download icon on a video thumbnail, preferring the large file', async () => {
    document.head.innerHTML = '';
    document.body.innerHTML = `
      <li class="card"><div class="shot-title">Animated onboarding flow</div>
      <div class="shot" data-video-teaser-small="https://cdn.example.com/small-1.mp4" data-video-teaser-large="https://cdn.example.com/large-1.mp4">
        <img src="https://cdn.example.com/still.png" data-animated-url="https://cdn.example.com/anim-1.mp4">
      </div></li>
      <div class="plain" data-id="7"><img src="https://cdn.example.com/photo.png"></div>`;
    const messages: Message[] = [];
    installChrome(messages);
    await import('../src/content/video-page');
    await vi.waitFor(() => expect(messages.some((m) => m.type === 'page-videos')).toBe(true), { timeout: 2000 });
    expect(messages.filter((m) => m.type === 'inspect-media').map((m) => m.url)).toEqual(['https://cdn.example.com/large-1.mp4']);
    expect(messages.filter((m) => m.type === 'page-videos').at(-1)?.videos?.map((video) => video.url)).toEqual(['https://cdn.example.com/large-1.mp4']);
    expect(messages.filter((m) => m.type === 'page-videos').at(-1)?.videos?.[0]).toMatchObject({ title: 'Animated onboarding flow' });
    expect(document.querySelectorAll(VIDEO_TAG)).toHaveLength(1);

    const hoverVideo = document.createElement('video');
    hoverVideo.src = 'https://cdn.example.com/large-1.mp4';
    document.querySelector('.shot')?.append(hoverVideo);
    await new Promise((resolve) => setTimeout(resolve, 1000));
    expect(document.querySelectorAll(VIDEO_TAG)).toHaveLength(1);

    retire();
  });

  function installPerformance(names: string[]) {
    vi.stubGlobal('PerformanceObserver', class {
      observe() {}
      disconnect() {}
    });
    vi.spyOn(performance, 'getEntriesByType').mockReturnValue(names.map((name) => ({ name })) as unknown as PerformanceEntryList);
  }

  it('downloads streamed players through their HLS playlist on allowlisted sites', async () => {
    document.head.innerHTML = '';
    document.body.innerHTML = '<video src="blob:https://learn.example.org/abc"></video>';
    installPerformance(['https://cdn.example.org/app.js', 'https://cdn.example.org/v/master.m3u8']);
    const messages: Message[] = [];
    installChrome(messages, { streamDomains: ['example.org'] });
    await import('../src/content/video-page');
    await vi.waitFor(() => expect(messages.some((m) => m.type === 'page-videos')).toBe(true), { timeout: 2000 });
    expect(messages.filter((m) => m.type === 'inspect-media').map((m) => m.url)).toEqual(['https://cdn.example.org/v/master.m3u8']);
    expect(messages.filter((m) => m.type === 'page-videos').at(-1)?.videos?.map((video) => video.url)).toEqual(['https://cdn.example.org/v/master.m3u8']);
    retire();
    vi.restoreAllMocks();
  });

  it('ignores HLS playlists on sites that are not in the list', async () => {
    document.head.innerHTML = '';
    document.body.innerHTML = '<video src="blob:https://learn.example.org/abc"></video>';
    installPerformance(['https://cdn.example.org/v/master.m3u8']);
    const messages: Message[] = [];
    installChrome(messages, { streamDomains: ['other-site.com'] });
    await import('../src/content/video-page');
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(messages.filter((m) => m.type === 'inspect-media')).toEqual([]);
    expect(messages.filter((m) => m.type === 'page-videos' && m.videos && m.videos.length > 0)).toEqual([]);
    retire();
    vi.restoreAllMocks();
  });

  it('downloads DASH players through their .mpd manifest on allowlisted sites', async () => {
    document.head.innerHTML = '';
    document.body.innerHTML = '<video src="blob:https://learn.example.org/dash"></video>';
    installPerformance(['https://cdn.example.org/app.js', 'https://cdn.example.org/v/manifest.mpd']);
    const messages: Message[] = [];
    installChrome(messages, { streamDomains: ['example.org'] });
    await import('../src/content/video-page');
    await vi.waitFor(() => expect(messages.some((m) => m.type === 'page-videos')).toBe(true), { timeout: 2000 });
    expect(messages.filter((m) => m.type === 'inspect-media').map((m) => m.url)).toEqual(['https://cdn.example.org/v/manifest.mpd']);
    retire();
    vi.restoreAllMocks();
  });

  async function runPage(head: string, body: string, network: string[], domains: string[]) {
    document.head.innerHTML = head;
    document.body.innerHTML = body;
    installPerformance(network);
    const messages: Message[] = [];
    installChrome(messages, { streamDomains: domains });
    await import('../src/content/video-page');
    return messages;
  }

  const inspected = (messages: Message[]) => messages.filter((m) => m.type === 'inspect-media').map((m) => m.url);

  it('uses a download link the site declares on the player container', async () => {
    const messages = await runPage(
      '',
      '<div class="player" data-download-url="https://cdn.example.org/v/master.m3u8?token=abc"><video src="blob:https://learn.example.org/x"></video></div>',
      [],
      ['example.org'],
    );
    await vi.waitFor(() => expect(inspected(messages)).toEqual(['https://cdn.example.org/v/master.m3u8?token=abc']), { timeout: 2000 });
    retire();
    vi.restoreAllMocks();
  });

  it('uses a declared alternate DASH link and prefers declarations over network guesses', async () => {
    const messages = await runPage(
      '<link rel="alternate" type="application/dash+xml" href="https://cdn.example.org/v/stream.mpd?sig=1">',
      '<video src="blob:https://learn.example.org/y"></video>',
      ['https://cdn.example.org/ads/preroll.m3u8'],
      ['example.org'],
    );
    await vi.waitFor(() => expect(inspected(messages)).toEqual(['https://cdn.example.org/v/stream.mpd?sig=1']), { timeout: 2000 });
    retire();
    vi.restoreAllMocks();
  });

  it('ignores declarations on sites that are not in the stream list', async () => {
    const messages = await runPage(
      '<link rel="alternate" type="application/dash+xml" href="https://cdn.example.org/v/stream.mpd">',
      '<div data-download-url="https://cdn.example.org/v/master.m3u8"><video src="blob:https://learn.example.org/z"></video></div>',
      [],
      ['other-site.com'],
    );
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(inspected(messages)).toEqual([]);
    retire();
    vi.restoreAllMocks();
  });

  it('picks up a download link the site adds after the player starts', async () => {
    const messages = await runPage('', '<div class="player"><video src="blob:https://learn.example.org/late"></video></div>', [], ['example.org']);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(inspected(messages)).toEqual([]);
    document.querySelector('.player')?.setAttribute('data-download-url', 'https://cdn.example.org/v/late.mpd');
    await vi.waitFor(() => expect(inspected(messages)).toEqual(['https://cdn.example.org/v/late.mpd']), { timeout: 3000 });
    retire();
    vi.restoreAllMocks();
  });
});
