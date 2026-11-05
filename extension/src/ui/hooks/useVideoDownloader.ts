import { useEffect, useState } from 'react';
import type { Settings } from '../../core/types';
import { sendRequest } from '../../shared/messaging';
import { hasDownloaderPermissions, removeDownloaderPermissions, requestDownloaderPermissions } from '../../shared/permissions';

export function useVideoDownloader(settings: Settings | null, update: (patch: Partial<Settings>) => Promise<void>) {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!settings?.videoDownloader) {
      return;
    }
    void hasDownloaderPermissions().then((granted) => {
      if (!granted) {
        void update({ videoDownloader: false });
      }
    });
  }, [settings?.videoDownloader, update]);

  const setEnabled = async (enabled: boolean) => {
    setError(null);
    if (enabled) {
      const permission = await requestDownloaderPermissions();
      if (!permission.granted) {
        setError(`${permission.error} The downloader stays off.`);
        return;
      }
      await update({ videoDownloader: true });
    } else {
      await update({ videoDownloader: false });
      await removeDownloaderPermissions();
    }
    await sendRequest({ type: 'sync-video-sites' });
  };

  return { setEnabled, error };
}
