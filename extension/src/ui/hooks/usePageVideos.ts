import { useCallback, useEffect, useState } from 'react';
import type { DownloadResult, ScheduleResult } from '../../core/messages';
import type { PageVideo } from '../../core/types';
import { sendRequest } from '../../shared/messaging';
import { onKeyChanged, pageVideosKey } from '../../shared/storage-keys';

export type PageVideoState =
  | { status: 'idle' }
  | { status: 'starting' }
  | { status: 'started' }
  | { status: 'scheduled'; startsNow: boolean }
  | { status: 'error'; message: string };

export type PageVideoAction = 'download' | 'audio' | 'tonight';

async function activeTab(): Promise<chrome.tabs.Tab | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) {
    return null;
  }
  return tab;
}

function send(action: PageVideoAction, video: PageVideo, pageUrl: string | undefined): Promise<DownloadResult | ScheduleResult | null> {
  if (action === 'tonight') {
    return sendRequest({ type: 'schedule-download', url: video.url, title: video.title, pageUrl });
  }
  return sendRequest({ type: 'download', url: video.url, title: video.title, pageUrl, audioOnly: action === 'audio' });
}

function nextState(result: DownloadResult | ScheduleResult | null): PageVideoState {
  if (!result) {
    return { status: 'error', message: 'Could not start the download' };
  }
  if (!result.ok) {
    return { status: 'error', message: result.error };
  }
  if ('startsNow' in result) {
    return { status: 'scheduled', startsNow: result.startsNow };
  }
  return { status: 'started' };
}

export function usePageVideos() {
  const [videos, setVideos] = useState<PageVideo[] | null>(null);
  const [states, setStates] = useState<Record<string, PageVideoState>>({});

  const load = useCallback(async (tabId: number) => {
    const response = await sendRequest({ type: 'tab-videos', tabId });
    if (!response) {
      setVideos([]);
      return;
    }
    setVideos(response.videos);
  }, []);

  useEffect(() => {
    let stop: () => void = () => undefined;
    let closed = false;
    void activeTab().then((tab) => {
      if (closed) {
        return;
      }
      if (!tab || tab.id === undefined) {
        setVideos([]);
        return;
      }
      const tabId = tab.id;
      void load(tabId);
      stop = onKeyChanged('session', pageVideosKey(tabId), () => void load(tabId));
    });
    return () => {
      closed = true;
      stop();
    };
  }, [load]);

  const run = useCallback(async (video: PageVideo, action: PageVideoAction) => {
    setStates((current) => ({ ...current, [video.url]: { status: 'starting' } }));
    const tab = await activeTab();
    const pageUrl = tab ? tab.url : undefined;
    const next = nextState(await send(action, video, pageUrl));
    setStates((current) => ({ ...current, [video.url]: next }));
  }, []);

  return { videos, states, run };
}
