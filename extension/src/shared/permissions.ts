import { WEB_ORIGINS } from '../core/constants';

const DOWNLOADER: chrome.permissions.Permissions = {
  permissions: ['downloads', 'downloads.open', 'notifications', 'scripting'],
  origins: WEB_ORIGINS,
};

export function requestDownloaderPermissions(): Promise<boolean> {
  return chrome.permissions.request(DOWNLOADER).catch(() => false);
}

export function hasDownloaderPermissions(): Promise<boolean> {
  return chrome.permissions.contains(DOWNLOADER).catch(() => false);
}

export async function removeDownloaderPermissions(): Promise<void> {
  await chrome.permissions.remove(DOWNLOADER).catch(() => false);
}
