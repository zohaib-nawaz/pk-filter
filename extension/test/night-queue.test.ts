import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DownloadResult } from '../src/core/messages';
import type { ScheduledDownload } from '../src/core/types';

function installChrome(nightStartHour: number, nightEndHour: number) {
  const local: Record<string, unknown> = {};
  const alarms: Array<{ name: string; when: number }> = [];
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: async (key: string) => ({ [key]: local[key] }),
        set: async (items: Record<string, unknown>) => Object.assign(local, items),
      },
      sync: { get: async () => ({ settings: { nightStartHour, nightEndHour } }) },
    },
    alarms: {
      create: async (name: string, info: { when: number }) => alarms.push({ name, when: info.when }),
      clear: async () => true,
      onAlarm: { addListener: () => undefined },
    },
  });
  return { queue: () => (local['night-queue'] as ScheduledDownload[] | undefined) || [], alarms };
}

const item = (url: string) => ({ url, title: 'Clip', pageUrl: null, audioOnly: false });

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('night queue', () => {
  it('queues outside the window, refuses duplicates and sets an alarm', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 10, 5, 14, 0));
    const fake = installChrome(1, 9);
    const { scheduleDownload } = await import('../src/background/night-queue');
    expect(await scheduleDownload(item('https://a.example/v.mp4'))).toEqual({ ok: true, startsNow: false });
    expect(await scheduleDownload(item('https://a.example/v.mp4'))).toMatchObject({ ok: false, error: 'Already scheduled for tonight' });
    expect(fake.queue()).toHaveLength(1);
    expect(new Date(fake.alarms.at(-1)?.when as number).getHours()).toBe(1);
  });

  it('starts everything inside the window once and keeps failures with their reason', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 10, 5, 2, 0));
    const fake = installChrome(1, 9);
    const started: string[] = [];
    const start = vi.fn(async (url: string): Promise<DownloadResult> => {
      started.push(url);
      if (url.includes('bad')) {
        return { ok: false, error: 'Turn on the video downloader' };
      }
      return { ok: true };
    });
    const { scheduleDownload, watchNightQueue } = await import('../src/background/night-queue');
    await scheduleDownload(item('https://a.example/good.mp4'));
    await scheduleDownload(item('https://a.example/bad.mp4'));
    watchNightQueue(start);
    await vi.waitFor(() => expect(fake.queue().every((entry) => entry.error)).toBe(true));
    expect(started.sort()).toEqual(['https://a.example/bad.mp4', 'https://a.example/good.mp4']);
    expect(fake.queue()).toMatchObject([{ url: 'https://a.example/bad.mp4', error: 'Turn on the video downloader' }]);
  });
});
