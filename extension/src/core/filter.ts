import type { DisplayStatus, Settings } from './types';

export function isHidden(status: DisplayStatus, settings: Settings): boolean {
  if (!settings.enabled || settings.filterMode === 'all' || status === 'checking') return false;
  if (status === 'blocked') return true;
  if (status === 'possibly_blocked') return settings.filterMode === 'only_accessible';
  if (status === 'unknown' || status === 'server_error') return !settings.showUnknown;
  return false;
}
