import { createLimiter } from '../core/limiter';
import type { DownloadRecord } from '../core/types';

const RECORDS_KEY = 'downloads';
const MAX_RECORDS = 50;
const queue = createLimiter(1);

export async function readDownloadRecords(): Promise<DownloadRecord[]> {
  const stored = await chrome.storage.local.get(RECORDS_KEY);
  const records = stored[RECORDS_KEY];
  if (!Array.isArray(records)) {
    return [];
  }
  return records as DownloadRecord[];
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
  const handler = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area === 'local' && changes[RECORDS_KEY]) {
      listener();
    }
  };
  chrome.storage.onChanged.addListener(handler);
  return () => chrome.storage.onChanged.removeListener(handler);
}
