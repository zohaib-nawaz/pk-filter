import { useCallback, useEffect, useState } from 'react';
import type { PageVideo } from '../../core/types';
import { sendRequest } from '../../shared/messaging';

export type PageVideoState = { status: 'idle' } | { status: 'starting' } | { status: 'started' } | { status: 'error'; message: string };

async function activeTab(): Promise<chrome.tabs.Tab | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab ?? null;
}

export function usePageVideos() {
  const [videos, setVideos] = useState<PageVideo[] | null>(null);
  const [states, setStates] = useState<Record<string, PageVideoState>>({});

  const load = useCallback(async () => {
    const tabId = (await activeTab())?.id;
    const response = tabId === undefined ? null : await sendRequest({ type: 'tab-videos', tabId });
    if (!response) {
      setVideos([]);
      return;
    }
    setVideos(response.videos);
  }, []);

  useEffect(() => {
    void load();
    const onChanged = (_changes: unknown, area: string) => {
      if (area === 'session') {
        void load();
      }
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, [load]);

  const download = useCallback(async (video: PageVideo) => {
    setStates((current) => ({ ...current, [video.url]: { status: 'starting' } }));
    const pageUrl = (await activeTab())?.url;
    const result = await sendRequest({ type: 'download', url: video.url, title: video.title, pageUrl });
    const next: PageVideoState = result?.ok
      ? { status: 'started' }
      : { status: 'error', message: result?.error ?? 'Could not start the download' };
    setStates((current) => ({ ...current, [video.url]: next }));
  }, []);

  return { videos, states, download };
}
