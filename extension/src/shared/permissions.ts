import { WEB_ORIGINS } from '../core/constants';

const DOWNLOADER: chrome.permissions.Permissions = {
  permissions: ['downloads', 'downloads.open', 'notifications', 'scripting'],
  origins: WEB_ORIGINS,
};

export interface PermissionResult {
  granted: boolean;
  error: string | null;
}

export async function requestDownloaderPermissions(): Promise<PermissionResult> {
  try {
    const granted = await chrome.permissions.request(DOWNLOADER);
    return { granted, error: granted ? null : 'You declined the Chrome permission prompt.' };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { granted: false, error: `Chrome refused the request (${reason}). Reload the extension in chrome://extensions and try again.` };
  }
}

export function hasDownloaderPermissions(): Promise<boolean> {
  return chrome.permissions.contains(DOWNLOADER).catch(() => false);
}

export async function removeDownloaderPermissions(): Promise<void> {
  await chrome.permissions.remove(DOWNLOADER).catch(() => false);
}
