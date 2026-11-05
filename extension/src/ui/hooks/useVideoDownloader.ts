import { useCallback } from 'react';
import type { Settings } from '../../core/types';
import { sendRequest } from '../../shared/messaging';
import { DOWNLOADER_PERMISSIONS } from '../../shared/permissions';
import type { SettingsUpdate } from '../../shared/storage';
import { usePermissionToggle } from './usePermissionToggle';

const syncVideoSites = () => sendRequest({ type: 'sync-video-sites' });

export function useVideoDownloader(settings: Settings | null, update: (patch: SettingsUpdate) => Promise<void>) {
  const save = useCallback((videoDownloader: boolean) => update({ videoDownloader }), [update]);
  return usePermissionToggle({
    enabled: settings ? settings.videoDownloader : false,
    permissions: DOWNLOADER_PERMISSIONS,
    save,
    refusedSuffix: ' The downloader stays off.',
    afterChange: syncVideoSites,
  });
}
