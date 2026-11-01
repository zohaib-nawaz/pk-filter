import { afterEach, describe, expect, it, vi } from 'vitest';

type Message = { type: string; url?: string; videos?: Array<{ url: string; title?: string }> };

function installChrome(messages: Message[], extra: Record<string, unknown> = {}) {
  const settings = { videoDownloader: true, videoOnPages: true, ...extra };
  vi.stubGlobal('chrome', {
    runtime: {
      sendMessage: async (message: Message) => {
        messages.push(message);
        if (message.type !== 'inspect-media') return { ok: true };
        if (message.url?.endsWith('.m3u8')) {
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

afterEach(() => {
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
    expect(document.querySelectorAll('pkaf-video')).toHaveLength(5);

    document.dispatchEvent(new CustomEvent('pkaf-video-takeover'));
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

    document.dispatchEvent(new CustomEvent('pkaf-video-takeover'));
    expect(document.querySelectorAll('pkaf-video')).toHaveLength(0);
    expect(messages.filter((m) => m.type === 'page-videos').at(-1)?.videos).toEqual([]);
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
    expect(document.querySelectorAll('pkaf-video')).toHaveLength(1);

    const hoverVideo = document.createElement('video');
    hoverVideo.src = 'https://cdn.example.com/large-1.mp4';
    document.querySelector('.shot')?.append(hoverVideo);
    await new Promise((resolve) => setTimeout(resolve, 1000));
    expect(document.querySelectorAll('pkaf-video')).toHaveLength(1);

    document.dispatchEvent(new CustomEvent('pkaf-video-takeover'));
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
    document.dispatchEvent(new CustomEvent('pkaf-video-takeover'));
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
    expect(messages.filter((m) => m.type === 'page-videos').flatMap((m) => m.videos ?? [])).toEqual([]);
    document.dispatchEvent(new CustomEvent('pkaf-video-takeover'));
    vi.restoreAllMocks();
  });
});
