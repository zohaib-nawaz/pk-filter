import { useCallback, useEffect, useState } from 'react';
import type { DownloadView } from '../../core/types';
import { onDownloadRecordsChanged } from '../../shared/download-store';
import { downloadActions, isDownloaderAvailable, listDownloads, onStreamJobsChanged } from '../../shared/downloads-client';

const PROGRESS_REFRESH_MS = 1000;

type DownloadAction = keyof typeof downloadActions;

export function useDownloads() {
  const [items, setItems] = useState<DownloadView[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setItems(await listDownloads());
  }, []);

  useEffect(() => {
    void refresh();
    const stopRecords = onDownloadRecordsChanged(() => void refresh());
    const stopStreams = onStreamJobsChanged(() => void refresh());
    const onChanged = () => void refresh();
    chrome.downloads?.onChanged.addListener(onChanged);
    return () => {
      stopRecords();
      stopStreams();
      chrome.downloads?.onChanged.removeListener(onChanged);
    };
  }, [refresh]);

  const hasRunning = items.some((item) => item.kind === 'file' && item.state === 'in_progress');
  useEffect(() => {
    if (!hasRunning) {
      return;
    }
    const timer = window.setInterval(() => void refresh(), PROGRESS_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [hasRunning, refresh]);

  const run = useCallback(
    async (action: DownloadAction, view: DownloadView) => {
      setMessage(null);
      try {
        setMessage(await downloadActions[action](view));
      } catch (error) {
        setMessage(error instanceof Error ? error.message : 'Action failed');
      }
      await refresh();
    },
    [refresh],
  );

  return { items, message, available: isDownloaderAvailable(), run };
}
