import { GOOGLE_SEARCH_MATCHES, WEB_ORIGINS } from '../core/constants';
import { hasDownloaderPermissions } from '../shared/permissions';
import { loadSettings } from '../shared/storage';

const SCRIPT_ID = 'pkaf-video-pages';

export async function syncVideoSites(): Promise<boolean> {
  if (!chrome.scripting) return false;
  const settings = await loadSettings();
  const wanted = settings.videoDownloader && settings.videoOnPages && (await hasDownloaderPermissions());
  const registered = await chrome.scripting.getRegisteredContentScripts({ ids: [SCRIPT_ID] });
  if (wanted && registered.length === 0) {
    await chrome.scripting.registerContentScripts([
      {
        id: SCRIPT_ID,
        js: ['video.js'],
        matches: WEB_ORIGINS,
        excludeMatches: GOOGLE_SEARCH_MATCHES,
        runAt: 'document_idle',
        persistAcrossSessions: true,
      },
    ]);
  }
  if (!wanted && registered.length > 0) await chrome.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] });
  return wanted;
}
