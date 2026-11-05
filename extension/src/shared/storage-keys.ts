export function pageVideosKey(tabId: number): string {
  return `page-videos:${tabId}`;
}

export type StorageAreaName = 'local' | 'sync' | 'session';

function area(name: StorageAreaName): chrome.storage.StorageArea {
  return chrome.storage[name];
}

export async function readList<T>(name: StorageAreaName, key: string): Promise<T[]> {
  const stored = await area(name).get(key);
  const value = stored[key];
  if (!Array.isArray(value)) {
    return [];
  }
  return value as T[];
}

export function onKeyChanged(name: StorageAreaName, key: string, listener: () => void): () => void {
  const handler = (changes: Record<string, chrome.storage.StorageChange>, changedArea: string) => {
    if (changedArea === name && changes[key]) {
      listener();
    }
  };
  chrome.storage.onChanged.addListener(handler);
  return () => chrome.storage.onChanged.removeListener(handler);
}
