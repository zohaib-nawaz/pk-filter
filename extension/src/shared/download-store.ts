import type { DownloadRecord } from '../core/types';

const RECORDS_KEY = 'downloads';
const MAX_RECORDS = 50;

export async function readDownloadRecords(): Promise<DownloadRecord[]> {
  const stored = await chrome.storage.local.get(RECORDS_KEY);
  return (stored[RECORDS_KEY] as DownloadRecord[] | undefined) ?? [];
}

export async function addDownloadRecord(record: DownloadRecord): Promise<void> {
  const records = (await readDownloadRecords()).filter((item) => item.id !== record.id);
  await chrome.storage.local.set({ [RECORDS_KEY]: [record, ...records].slice(0, MAX_RECORDS) });
}

export async function removeDownloadRecord(id: number): Promise<void> {
  const records = await readDownloadRecords();
  await chrome.storage.local.set({ [RECORDS_KEY]: records.filter((item) => item.id !== id) });
}

export function onDownloadRecordsChanged(listener: () => void): () => void {
  const handler = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area === 'local' && changes[RECORDS_KEY]) listener();
  };
  chrome.storage.onChanged.addListener(handler);
  return () => chrome.storage.onChanged.removeListener(handler);
}
