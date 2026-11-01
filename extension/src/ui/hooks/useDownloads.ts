import { useCallback, useEffect, useState } from 'react';
import type { DownloadRecord, DownloadView } from '../../core/types';
import { onDownloadRecordsChanged } from '../../shared/download-store';
import { downloadActions, isDownloaderAvailable, listDownloads } from '../../shared/downloads-client';

const PROGRESS_REFRESH_MS = 1000;

export function useDownloads() {
  const [items, setItems] = useState<DownloadView[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setItems(await listDownloads());
  }, []);

  useEffect(() => {
    void refresh();
    const stopRecords = onDownloadRecordsChanged(() => void refresh());
    const onChanged = () => void refresh();
    chrome.downloads?.onChanged.addListener(onChanged);
    return () => {
      stopRecords();
      chrome.downloads?.onChanged.removeListener(onChanged);
    };
  }, [refresh]);

  const hasRunning = items.some((item) => item.state === 'in_progress');
  useEffect(() => {
    if (!hasRunning) return;
    const timer = window.setInterval(() => void refresh(), PROGRESS_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [hasRunning, refresh]);

  const run = useCallback(
    async (action: () => Promise<unknown>) => {
      setMessage(null);
      try {
        await action();
      } catch (error) {
        setMessage(error instanceof Error ? error.message : 'Action failed');
      }
      await refresh();
    },
    [refresh],
  );

  return {
    items,
    message,
    available: isDownloaderAvailable(),
    pause: (id: number) => run(() => downloadActions.pause(id)),
    resume: (id: number) => run(() => downloadActions.resume(id)),
    cancel: (id: number) => run(() => downloadActions.cancel(id)),
    open: (id: number) => run(() => downloadActions.open(id)),
    show: (id: number) => run(() => downloadActions.show(id)),
    remove: (id: number) => run(() => downloadActions.remove(id)),
    retry: (record: DownloadRecord) =>
      run(async () => {
        const result = await downloadActions.retry(record);
        if (result && !result.ok) setMessage(result.error);
      }),
  };
}
