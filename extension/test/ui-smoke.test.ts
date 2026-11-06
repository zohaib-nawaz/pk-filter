import { act, createElement, type ComponentType } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

type Message = { type: string; domain?: string; tabId?: number };

const now = new Date().toISOString();

const result = (domain: string, status: string) => ({
  domain,
  status,
  confidence: 0.9,
  country: 'NL',
  lastChecked: now,
  evidence: ['dns_resolved'],
  method: 'probe',
  network: { isp: 'NetOne', asn: 'AS64500', city: 'Capital City' },
  ttlSeconds: 1200,
});

const local: Record<string, unknown> = {
  'night-queue': [{ id: 'n1', url: 'https://videos.example.com/a.m3u8', title: 'Lecture one', pageUrl: null, audioOnly: true, addedAt: now }],
};

let oldWorker = false;

function answer(message: Message): unknown {
  if (message.type === 'site-status') {
    return { domain: message.domain, result: result(message.domain as string, 'blocked'), history: null };
  }
  if (message.type === 'tab-videos') {
    return { videos: [{ url: 'https://videos.example.com/a.m3u8', title: 'Lecture one', extension: 'mp4', sizeBytes: 5_000_000, separateAudio: true }] };
  }
  if (message.type === 'overview' && oldWorker) {
    return { cachedDomains: 1, sync: { lastSync: null, lastError: null }, service: { online: true, country: 'NL', network: null, networks: [], ooni: true } };
  }
  if (message.type === 'overview') {
    return {
      cachedDomains: 3,
      sync: { lastSync: now, lastError: null },
      service: { online: true, country: 'NL', network: { isp: 'NetOne', asn: 'AS64500', city: 'Capital City' }, networks: [], ooni: true, probeCountries: ['NL'] },
      viewer: { country: 'DE', source: 'ip', measuredBy: 'ooni' },
    };
  }
  if (message.type === 'schedule-download') {
    return { ok: true, startsNow: false };
  }
  return { ok: true };
}

function installChrome(settings: Record<string, unknown>) {
  const sent: Message[] = [];
  vi.stubGlobal('chrome', {
    runtime: {
      id: 'test',
      sendMessage: async (message: Message) => {
        sent.push(message);
        return answer(message);
      },
      getURL: (path: string) => `chrome-extension://test/${path}`,
      getManifest: () => ({ optional_permissions: ['downloads', 'downloads.open', 'notifications', 'scripting', 'webNavigation'] }),
      openOptionsPage: () => undefined,
    },
    storage: {
      sync: { get: async () => ({ settings }), set: async () => undefined },
      local: { get: async (key: string) => ({ [key]: local[key] }), set: async () => undefined },
      onChanged: { addListener: () => undefined, removeListener: () => undefined },
    },
    tabs: { query: async () => [{ id: 7, url: 'https://videos.example.com/watch' }] },
    permissions: { contains: async () => true, request: async () => true, remove: async () => true },
    downloads: { search: async () => [], onChanged: { addListener: () => undefined, removeListener: () => undefined } },
  });
  return sent;
}

let root: Root | null = null;

async function render(App: ComponentType): Promise<HTMLElement> {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  document.body.innerHTML = '<div id="root"></div>';
  const container = document.getElementById('root') as HTMLElement;
  await act(async () => {
    root = createRoot(container);
    root.render(createElement(App));
  });
  return container;
}

afterEach(async () => {
  await act(async () => {
    if (root) {
      root.unmount();
    }
  });
  root = null;
  oldWorker = false;
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('extension pages render', () => {
  it('explains a site that failed to load', async () => {
    installChrome({});
    window.history.replaceState({}, '', '/site/index.html?domain=example.com&mode=failed&url=https%3A%2F%2Fexample.com%2F&error=CONNECTION_RESET');
    const { App } = await import('../src/site/App');
    const page = await render(App);
    await vi.waitFor(() => expect(page.textContent).toContain('appears to be blocked in Netherlands'));
    expect(page.textContent).toContain('example.com did not open');
    expect(page.textContent).toContain('cut off');
    expect(page.textContent).toContain('Try again');
    expect(page.textContent).toContain('Open archived copy');
  });

  it('shows the new settings', async () => {
    installChrome({ videoDownloader: true });
    const { App } = await import('../src/options/App');
    const page = await render(App);
    await vi.waitFor(() => expect(page.textContent).toContain('Night downloads'));
    for (const text of ['Explain sites that fail to load', 'Stream quality', 'Save subtitles', 'Starts at', 'Ends at', 'Automatic, from my IP address (now: Germany)', 'Also check from my own connection', 'Germany · OONI reports']) {
      expect(page.textContent).toContain(text);
    }
  });

  it('still renders settings when an older service worker answers', async () => {
    oldWorker = true;
    installChrome({});
    const { App } = await import('../src/options/App');
    const page = await render(App);
    await vi.waitFor(() => expect(page.textContent).toContain('Test servers run in your server’s country'));
  });

  it('offers audio only and tonight in the popup and lists the night queue', async () => {
    const sent = installChrome({ videoDownloader: true });
    const { App } = await import('../src/popup/App');
    const page = await render(App);
    await vi.waitFor(() => expect(page.textContent).toContain('Audio only'));
    expect(page.textContent).toContain('Tonight, 1:00 AM to 9:00 AM (1)');
    const tonight = [...page.querySelectorAll('button')].find((button) => button.textContent === 'Tonight') as HTMLButtonElement;
    await act(async () => {
      tonight.click();
    });
    await vi.waitFor(() => expect(sent.some((message) => message.type === 'schedule-download')).toBe(true));
    await vi.waitFor(() => expect(page.textContent).toContain('Scheduled for tonight'));
  });
});
