import { WEB_ORIGINS } from '../core/constants';
import { errorMessage } from '../core/errors';

type Permission = chrome.runtime.ManifestPermission;

export type PermissionSet = () => chrome.permissions.Permissions;

export interface PermissionResult {
  granted: boolean;
  error: string | null;
}

function declared(permissions: Permission[]): Permission[] {
  const optional = chrome.runtime.getManifest().optional_permissions;
  if (!optional) {
    return permissions;
  }
  return permissions.filter((permission) => (optional as string[]).includes(permission));
}

export const DOWNLOADER_PERMISSIONS: PermissionSet = () => ({
  permissions: declared(['downloads', 'downloads.open', 'notifications', 'scripting']),
  origins: WEB_ORIGINS,
});

export const FAILURE_HELPER_PERMISSIONS: PermissionSet = () => ({ permissions: declared(['webNavigation']) });

export async function requestPermissions(set: PermissionSet): Promise<PermissionResult> {
  try {
    const granted = await chrome.permissions.request(set());
    if (granted) {
      return { granted, error: null };
    }
    return { granted, error: 'You declined the browser permission prompt.' };
  } catch (error) {
    const reason = errorMessage(error, 'unknown error');
    return { granted: false, error: `The browser refused the request (${reason}). Reload the extension and try again.` };
  }
}

export function hasPermissions(set: PermissionSet): Promise<boolean> {
  return chrome.permissions.contains(set()).catch(() => false);
}

export async function removePermissions(set: PermissionSet): Promise<void> {
  await chrome.permissions.remove(set()).catch(() => false);
}

export function hasDownloaderPermissions(): Promise<boolean> {
  return hasPermissions(DOWNLOADER_PERMISSIONS);
}
