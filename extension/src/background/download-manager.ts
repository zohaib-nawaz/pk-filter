import { describeInterrupt } from '../core/download-errors';
import { buildFilename, titleFromUrl } from '../core/filename';
import type { DownloadResult } from '../core/messages';
import { addDownloadRecord, readDownloadRecords } from '../shared/download-store';
import { inspectMedia } from './media-inspector';

const starting = new Set<string>();
let watching = false;

async function updateBadge(): Promise<void> {
  if (!chrome.downloads) return;
  const records = await readDownloadRecords();
  const active = await chrome.downloads.search({ state: 'in_progress' });
  const ids = new Set(records.map((record) => record.id));
  const count = active.filter((item) => ids.has(item.id)).length;
  await chrome.action.setBadgeBackgroundColor({ color: '#188038' });
  await chrome.action.setBadgeText({ text: count > 0 ? String(count) : '' });
}

function notify(id: number, title: string, message: string): void {
  chrome.notifications?.create(`pkaf-download-${id}`, {
    type: 'basic',
    iconUrl: chrome.runtime.getURL('icons/icon-128.png'),
    title,
    message,
  });
}

async function handleChange(delta: chrome.downloads.DownloadDelta): Promise<void> {
  if (!delta.state?.current) return;
  const record = (await readDownloadRecords()).find((item) => item.id === delta.id);
  if (!record) return;
  await updateBadge();
  if (delta.state.current === 'complete') notify(record.id, 'Download complete', record.title);
  if (delta.state.current === 'interrupted') {
    const [item] = await chrome.downloads.search({ id: delta.id });
    if (item?.error !== 'USER_CANCELED') notify(record.id, 'Download failed', `${record.title}: ${describeInterrupt(item?.error)}`);
  }
}

export function watchDownloads(): void {
  if (watching || !chrome.downloads) return;
  watching = true;
  chrome.downloads.onChanged.addListener((delta) => void handleChange(delta));
  chrome.downloads.onCreated.addListener(() => void updateBadge());
  void updateBadge();
}

export async function startDownload(rawUrl: string, title: string): Promise<DownloadResult> {
  if (!chrome.downloads) return { ok: false, error: 'Turn on the video downloader in the extension settings' };
  const info = await inspectMedia(rawUrl);
  if (info.status !== 'downloadable' || !info.extension) return { ok: false, error: info.reason };
  if (starting.has(info.url)) return { ok: false, error: 'This download is already starting' };
  starting.add(info.url);
  try {
    const active = await chrome.downloads.search({ url: info.url, state: 'in_progress' });
    if (active.length > 0) return { ok: false, error: 'This video is already downloading' };
    const name = title.trim() || titleFromUrl(info.url);
    const id = await chrome.downloads.download({
      url: info.url,
      filename: buildFilename(name, info.extension),
      conflictAction: 'uniquify',
      saveAs: false,
    });
    await addDownloadRecord({
      id,
      url: info.url,
      title: name,
      extension: info.extension,
      sizeBytes: info.sizeBytes,
      startedAt: new Date().toISOString(),
    });
    watchDownloads();
    void updateBadge();
    return { ok: true, id };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Chrome could not start the download' };
  } finally {
    starting.delete(info.url);
  }
}
