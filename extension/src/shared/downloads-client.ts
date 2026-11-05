import { toDownloadView, toStreamView } from '../core/downloads';
import type { StreamJob } from '../core/stream-jobs';
import type { DownloadView } from '../core/types';
import { readDownloadRecords } from './download-store';
import { sendRequest } from './messaging';

const STREAM_JOBS_KEY = 'stream-jobs';

async function readStreamJobs(): Promise<StreamJob[]> {
  const stored = await chrome.storage.local.get(STREAM_JOBS_KEY);
  const jobs = stored[STREAM_JOBS_KEY];
  if (!Array.isArray(jobs)) {
    return [];
  }
  return jobs as StreamJob[];
}

async function fileViews(): Promise<DownloadView[]> {
  const records = await readDownloadRecords();
  if (!chrome.downloads) {
    return records.map((record) => toDownloadView(record, undefined));
  }
  const items = await Promise.all(records.map((record) => chrome.downloads.search({ id: record.id })));
  return records.map((record, index) => toDownloadView(record, items[index]?.[0]));
}

export async function listDownloads(): Promise<DownloadView[]> {
  const [files, streams] = await Promise.all([fileViews(), readStreamJobs()]);
  return [...files, ...streams.map(toStreamView)].sort((a, b) => b.record.startedAt.localeCompare(a.record.startedAt));
}

export function onStreamJobsChanged(listener: () => void): () => void {
  const handler = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area === 'local' && changes[STREAM_JOBS_KEY]) {
      listener();
    }
  };
  chrome.storage.onChanged.addListener(handler);
  return () => chrome.storage.onChanged.removeListener(handler);
}

export function isDownloaderAvailable(): boolean {
  return Boolean(chrome.downloads);
}

async function streamControl(view: DownloadView, action: 'pause' | 'resume' | 'cancel' | 'retry' | 'remove'): Promise<string | null> {
  const result = await sendRequest({ type: 'stream-control', id: view.streamId as string, action });
  if (result && result.ok) {
    return null;
  }
  return 'Could not update this stream download';
}

async function removeRecord(id: number): Promise<string | null> {
  const result = await sendRequest({ type: 'remove-download', id });
  if (result && result.ok) {
    return null;
  }
  return 'Could not remove this download';
}

async function retryFile(view: DownloadView): Promise<string | null> {
  const result = await sendRequest({ type: 'download', url: view.record.url, title: view.record.title });
  if (!result) {
    return 'Could not start the download';
  }
  if (!result.ok) {
    return result.error;
  }
  return removeRecord(view.record.id);
}

function fileOrStream(stream: StreamAction, file: (view: DownloadView) => Promise<unknown>) {
  return async (view: DownloadView): Promise<string | null> => {
    if (view.kind === 'stream') {
      return streamControl(view, stream);
    }
    await file(view);
    return null;
  };
}

type StreamAction = 'pause' | 'resume' | 'cancel' | 'retry' | 'remove';

export const downloadActions = {
  pause: fileOrStream('pause', (view) => chrome.downloads.pause(view.record.id)),
  resume: fileOrStream('resume', (view) => chrome.downloads.resume(view.record.id)),
  cancel: fileOrStream('cancel', (view) => chrome.downloads.cancel(view.record.id)),
  remove: async (view: DownloadView) => {
    if (view.kind === 'stream') {
      return streamControl(view, 'remove');
    }
    return removeRecord(view.record.id);
  },
  open: async (view: DownloadView) => {
    chrome.downloads.open(view.record.id);
    return null;
  },
  show: async (view: DownloadView) => {
    chrome.downloads.show(view.record.id);
    return null;
  },
  retry: async (view: DownloadView) => {
    if (view.kind === 'stream') {
      return streamControl(view, 'retry');
    }
    return retryFile(view);
  },
};
