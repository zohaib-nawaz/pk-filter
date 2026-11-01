import { toDownloadView } from '../core/downloads';
import type { DownloadRecord, DownloadView } from '../core/types';
import { readDownloadRecords, removeDownloadRecord } from './download-store';
import { sendRequest } from './messaging';

export async function listDownloads(): Promise<DownloadView[]> {
  const records = await readDownloadRecords();
  if (!chrome.downloads) return records.map((record) => toDownloadView(record, undefined));
  const items = await Promise.all(records.map((record) => chrome.downloads.search({ id: record.id })));
  return records.map((record, index) => toDownloadView(record, items[index]?.[0]));
}

export function isDownloaderAvailable(): boolean {
  return Boolean(chrome.downloads);
}

export const downloadActions = {
  pause: (id: number) => chrome.downloads.pause(id),
  resume: (id: number) => chrome.downloads.resume(id),
  cancel: (id: number) => chrome.downloads.cancel(id),
  open: async (id: number) => chrome.downloads.open(id),
  show: async (id: number) => chrome.downloads.show(id),
  remove: (id: number) => removeDownloadRecord(id),
  retry: async (record: DownloadRecord) => {
    const result = await sendRequest({ type: 'download', url: record.url, title: record.title });
    if (result?.ok) await removeDownloadRecord(record.id);
    return result;
  },
};
