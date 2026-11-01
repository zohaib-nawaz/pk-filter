import { afterEach, describe, expect, it, vi } from 'vitest';

type Message = { type: string; url?: string; videos?: Array<{ url: string }> };

function installChrome(messages: Message[]) {
  const settings = { videoDownloader: true, videoOnPages: true };
  vi.stubGlobal('chrome', {
    runtime: {
      sendMessage: async (message: Message) => {
        messages.push(message);
        if (message.type !== 'inspect-media') return { ok: true };
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
      observe() {}
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
});
