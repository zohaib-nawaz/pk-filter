import { createLimiter } from '../core/limiter';
import type { DownloadRecord } from '../core/types';
import { onKeyChanged, readList } from './storage-keys';

const RECORDS_KEY = 'downloads';
const MAX_RECORDS = 50;
const queue = createLimiter(1);

export function readDownloadRecords(): Promise<DownloadRecord[]> {
  return readList<DownloadRecord>('local', RECORDS_KEY);
}

function writeRecords(change: (records: DownloadRecord[]) => DownloadRecord[]): Promise<void> {
  return queue(async () => {
    const records = change(await readDownloadRecords());
    await chrome.storage.local.set({ [RECORDS_KEY]: records.slice(0, MAX_RECORDS) });
  });
}

export function addDownloadRecord(record: DownloadRecord): Promise<void> {
  return writeRecords((records) => [record, ...records.filter((item) => item.id !== record.id)]);
}

export function removeDownloadRecord(id: number): Promise<void> {
  return writeRecords((records) => records.filter((item) => item.id !== id));
}

export function onDownloadRecordsChanged(listener: () => void): () => void {
  return onKeyChanged('local', RECORDS_KEY, listener);
}
