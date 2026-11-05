import type { PageVideo } from '../core/types';

const KEY_PREFIX = 'page-videos:';
const BADGE_COLOR = '#188038';
let watching = false;

function key(tabId: number): string {
  return `${KEY_PREFIX}${tabId}`;
}

export async function setPageVideos(tabId: number, videos: PageVideo[]): Promise<void> {
  if (videos.length > 0) {
    await chrome.storage.session.set({ [key(tabId)]: videos });
  } else {
    await chrome.storage.session.remove(key(tabId));
  }
  await chrome.action.setBadgeBackgroundColor({ tabId, color: BADGE_COLOR }).catch(() => undefined);
  await chrome.action.setBadgeText({ tabId, text: videos.length > 0 ? String(videos.length) : '' }).catch(() => undefined);
}

export async function getPageVideos(tabId: number): Promise<PageVideo[]> {
  const stored = await chrome.storage.session.get(key(tabId));
  const videos = stored[key(tabId)];
  if (!Array.isArray(videos)) {
    return [];
  }
  return videos as PageVideo[];
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
