import { GOOGLE_SEARCH_MATCHES, WEB_ORIGINS } from '../core/constants';
import { hasDownloaderPermissions } from '../shared/permissions';
import { loadSettings } from '../shared/storage';

const SCRIPT_ID = 'pkaf-video-pages';
const SCRIPT_FILE = 'video.js';
const GOOGLE_SEARCH = /^https:\/\/(www\.)?google\.com(\.pk)?\/search/;

async function injectIntoOpenTabs(): Promise<void> {
  const tabs = await chrome.tabs.query({ url: WEB_ORIGINS });
  await Promise.all(
    tabs
      .filter((tab) => tab.id !== undefined && !GOOGLE_SEARCH.test(tab.url ?? ''))
      .map((tab) =>
        chrome.scripting.executeScript({ target: { tabId: tab.id as number }, files: [SCRIPT_FILE] }).catch(() => undefined),
      ),
  );
}

export async function syncVideoSites(reinject = false): Promise<boolean> {
  if (!chrome.scripting) return false;
  const settings = await loadSettings();
  const wanted = settings.videoDownloader && settings.videoOnPages && (await hasDownloaderPermissions());
  const registered = await chrome.scripting.getRegisteredContentScripts({ ids: [SCRIPT_ID] });
  if (wanted && registered.length === 0) {
    await chrome.scripting.registerContentScripts([
      {
        id: SCRIPT_ID,
        js: [SCRIPT_FILE],
        matches: WEB_ORIGINS,
        excludeMatches: GOOGLE_SEARCH_MATCHES,
        runAt: 'document_idle',
        persistAcrossSessions: true,
      },
    ]);
  }
  if (!wanted && registered.length > 0) await chrome.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] });
  if (wanted && (reinject || registered.length === 0)) await injectIntoOpenTabs();
  return wanted;
}
