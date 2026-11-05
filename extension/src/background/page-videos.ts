import type { PageVideo } from '../core/types';
import { pageVideosKey, readList } from '../shared/storage-keys';

const BADGE_COLOR = '#188038';
let watching = false;

const key = pageVideosKey;

export async function setPageVideos(tabId: number, videos: PageVideo[]): Promise<void> {
  if (videos.length > 0) {
    await chrome.storage.session.set({ [key(tabId)]: videos });
  } else {
    await chrome.storage.session.remove(key(tabId));
  }
  await chrome.action.setBadgeBackgroundColor({ tabId, color: BADGE_COLOR }).catch(() => undefined);
  await chrome.action.setBadgeText({ tabId, text: videos.length > 0 ? String(videos.length) : '' }).catch(() => undefined);
}

export function getPageVideos(tabId: number): Promise<PageVideo[]> {
  return readList<PageVideo>('session', key(tabId));
}

export function watchTabs(): void {
  if (watching) {
    return;
  }
  watching = true;
  chrome.tabs.onRemoved.addListener((tabId) => void chrome.storage.session.remove(key(tabId)));
  chrome.tabs.onUpdated.addListener((tabId, change) => {
    if (change.status === 'loading' && change.url) {
      void setPageVideos(tabId, []);
    }
  });
}
