import { afterEach, describe, expect, it, vi } from 'vitest';

type Message = { type: string; url?: string; videos?: Array<{ url: string }> };

function installChrome(messages: Message[]) {
  const settings = { videoDownloader: true, videoOnPages: true };
  vi.stubGlobal('chrome', {
    runtime: {
      sendMessage: async (message: Message) => {
        messages.push(message);
        if (message.type !== 'inspect-media') return { ok: true };
        const direct = message.url?.endsWith('.mp4');
        return direct
          ? { status: 'downloadable', url: message.url, extension: 'mp4', mime: 'video/mp4', sizeBytes: 1000, reason: 'Direct video file' }
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
    expect(document.querySelectorAll('pkaf-video')).toHaveLength(0);
    expect(messages.filter((m) => m.type === 'page-videos').at(-1)?.videos).toEqual([]);
  });
});
