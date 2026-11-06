import { buildFilename } from '../core/filename';

const MAX_PENDING = 50;
const byUrl = new Map<string, string>();
const byId = new Map<number, string>();
let watching = false;

function normalized(url: string): string {
  try {
    return new URL(url).href;
  } catch {
    return url;
  }
}

function remember<K>(map: Map<K, string>, key: K, filename: string): void {
  map.delete(key);
  map.set(key, filename);
  for (const oldest of map.keys()) {
    if (map.size <= MAX_PENDING) {
      break;
    }
    map.delete(oldest);
  }
}

function takeName(item: chrome.downloads.DownloadItem): string | undefined {
  const urls = [item.url, item.finalUrl].filter(Boolean).map(normalized);
  const filename = byId.get(item.id) ?? urls.map((url) => byUrl.get(url)).find(Boolean);
  byId.delete(item.id);
  for (const url of urls) {
    byUrl.delete(url);
  }
  return filename;
}

function suggestName(item: chrome.downloads.DownloadItem, suggest: (suggestion?: chrome.downloads.FilenameSuggestion) => void): void {
  if (item.byExtensionId !== chrome.runtime.id) {
    suggest();
    return;
  }
  const filename = takeName(item);
  if (!filename) {
    suggest();
    return;
  }
  suggest({ filename, conflictAction: 'uniquify' });
}

export function watchFilenames(): void {
  if (watching || !chrome.downloads || !chrome.downloads.onDeterminingFilename) {
    return;
  }
  watching = true;
  chrome.downloads.onDeterminingFilename.addListener(suggestName);
}

export async function saveFile(url: string, title: string, extension: string): Promise<number> {
  const filename = buildFilename(title, extension);
  const key = normalized(url);
  remember(byUrl, key, filename);
  watchFilenames();
  try {
    const id = await chrome.downloads.download({ url, filename, conflictAction: 'uniquify', saveAs: false });
    if (byUrl.has(key)) {
      remember(byId, id, filename);
    }
    return id;
  } catch (error) {
    byUrl.delete(key);
    throw error;
  }
}
