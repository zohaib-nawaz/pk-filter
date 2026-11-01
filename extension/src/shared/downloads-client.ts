import { toDownloadView, toStreamView } from '../core/downloads';
import type { StreamJob } from '../core/stream-jobs';
import type { DownloadView } from '../core/types';
import { readDownloadRecords, removeDownloadRecord } from './download-store';
import { sendRequest } from './messaging';

const STREAM_JOBS_KEY = 'stream-jobs';

async function readStreamJobs(): Promise<StreamJob[]> {
  const stored = await chrome.storage.local.get(STREAM_JOBS_KEY);
  return (stored[STREAM_JOBS_KEY] as StreamJob[] | undefined) ?? [];
}

async function fileViews(): Promise<DownloadView[]> {
  const records = await readDownloadRecords();
  if (!chrome.downloads) return records.map((record) => toDownloadView(record, undefined));
  const items = await Promise.all(records.map((record) => chrome.downloads.search({ id: record.id })));
  return records.map((record, index) => toDownloadView(record, items[index]?.[0]));
}

export async function listDownloads(): Promise<DownloadView[]> {
  const [files, streams] = await Promise.all([fileViews(), readStreamJobs()]);
  return [...files, ...streams.map(toStreamView)].sort((a, b) => b.record.startedAt.localeCompare(a.record.startedAt));
}

export function onStreamJobsChanged(listener: () => void): () => void {
  const handler = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area === 'local' && changes[STREAM_JOBS_KEY]) listener();
  };
  chrome.storage.onChanged.addListener(handler);
  return () => chrome.storage.onChanged.removeListener(handler);
}

export function isDownloaderAvailable(): boolean {
  return Boolean(chrome.downloads);
}

async function streamControl(view: DownloadView, action: 'pause' | 'resume' | 'cancel' | 'retry' | 'remove'): Promise<string | null> {
  const result = await sendRequest({ type: 'stream-control', id: view.streamId as string, action });
  return result?.ok ? null : 'Could not update this stream download';
}

export const downloadActions = {
  pause: async (view: DownloadView) => (view.kind === 'stream' ? streamControl(view, 'pause') : (await chrome.downloads.pause(view.record.id), null)),
  resume: async (view: DownloadView) => (view.kind === 'stream' ? streamControl(view, 'resume') : (await chrome.downloads.resume(view.record.id), null)),
  cancel: async (view: DownloadView) => (view.kind === 'stream' ? streamControl(view, 'cancel') : (await chrome.downloads.cancel(view.record.id), null)),
  remove: async (view: DownloadView) => (view.kind === 'stream' ? streamControl(view, 'remove') : (await removeDownloadRecord(view.record.id), null)),
  open: async (view: DownloadView) => (chrome.downloads.open(view.record.id), null),
  show: async (view: DownloadView) => (chrome.downloads.show(view.record.id), null),
  retry: async (view: DownloadView) => {
    if (view.kind === 'stream') return streamControl(view, 'retry');
    const result = await sendRequest({ type: 'download', url: view.record.url, title: view.record.title });
    if (!result?.ok) return result?.error ?? 'Could not start the download';
    await removeDownloadRecord(view.record.id);
    return null;
  },
};
