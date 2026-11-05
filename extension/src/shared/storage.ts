import { expiresAt } from '../core/cache-policy';
import { createLimiter } from '../core/limiter';
import { sanitizeSettings } from '../core/settings';
import type { CheckResult, Settings, SyncState } from '../core/types';
import { onKeyChanged } from './storage-keys';

const SETTINGS_KEY = 'settings';
const SYNC_KEY = 'sync';
const REFRESH_KEY = 'refreshRequestedAt';
const CACHE_PREFIX = 'cache:';
const MAX_CACHE_ENTRIES = 5_000;
const settingsQueue = createLimiter(1);
const syncQueue = createLimiter(1);

interface CacheEntry {
  result: CheckResult;
  expiresAt: number;
}

export type SettingsUpdate = Partial<Settings> | ((current: Settings) => Partial<Settings>);

export async function loadSettings(): Promise<Settings> {
  const stored = await chrome.storage.sync.get(SETTINGS_KEY);
  return sanitizeSettings(stored[SETTINGS_KEY]);
}

export function saveSettings(update: SettingsUpdate): Promise<Settings> {
  return settingsQueue(async () => {
    const current = await loadSettings();
    const patch = typeof update === 'function' ? update(current) : update;
    const next = sanitizeSettings({ ...current, ...patch });
    await chrome.storage.sync.set({ [SETTINGS_KEY]: next });
    return next;
  });
}

export function onSettingsChanged(listener: (settings: Settings) => void): () => void {
  const handler = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area === 'sync' && changes[SETTINGS_KEY]) {
      listener(sanitizeSettings(changes[SETTINGS_KEY].newValue));
    }
  };
  chrome.storage.onChanged.addListener(handler);
  return () => chrome.storage.onChanged.removeListener(handler);
}

export function onRefreshRequested(listener: () => void): () => void {
  return onKeyChanged('local', REFRESH_KEY, listener);
}

export async function requestRefresh(): Promise<void> {
  await chrome.storage.local.set({ [REFRESH_KEY]: Date.now() });
}

export async function readCache(domains: string[], now: number): Promise<Record<string, CheckResult>> {
  const results: Record<string, CheckResult> = {};
  if (domains.length === 0) {
    return results;
  }
  const stored = await chrome.storage.local.get(domains.map((domain) => CACHE_PREFIX + domain));
  for (const domain of domains) {
    const entry = stored[CACHE_PREFIX + domain] as CacheEntry | undefined;
    if (entry && entry.expiresAt > now) {
      results[domain] = entry.result;
    }
  }
  return results;
}

export async function writeCache(results: CheckResult[], settings: Settings, now: number): Promise<void> {
  const entries: Record<string, CacheEntry> = {};
  for (const result of results) {
    entries[CACHE_PREFIX + result.domain] = { result, expiresAt: expiresAt(result, settings, now) };
  }
  await chrome.storage.local.set(entries);
}

async function cacheEntries(): Promise<Array<[string, CacheEntry]>> {
  const all = await chrome.storage.local.get(null);
  return Object.entries(all).filter((entry): entry is [string, CacheEntry] => entry[0].startsWith(CACHE_PREFIX));
}

export async function countCache(now: number): Promise<number> {
  return (await cacheEntries()).filter(([, entry]) => entry.expiresAt > now).length;
}

export async function pruneCache(now: number): Promise<void> {
  const entries = await cacheEntries();
  const live = entries.filter(([, entry]) => entry.expiresAt > now).sort(([, a], [, b]) => b.expiresAt - a.expiresAt);
  const expired = entries.filter(([, entry]) => entry.expiresAt <= now);
  const overflow = live.slice(MAX_CACHE_ENTRIES);
  const keys = [...expired, ...overflow].map(([key]) => key);
  if (keys.length > 0) {
    await chrome.storage.local.remove(keys);
  }
}

export async function clearCache(): Promise<void> {
  const keys = (await cacheEntries()).map(([key]) => key);
  if (keys.length > 0) {
    await chrome.storage.local.remove(keys);
  }
}

export async function readSync(): Promise<SyncState> {
  const stored = await chrome.storage.local.get(SYNC_KEY);
  const saved = stored[SYNC_KEY] as Partial<SyncState> | undefined;
  return { lastSync: null, lastError: null, ...saved };
}

export function writeSync(patch: Partial<SyncState>): Promise<void> {
  return syncQueue(async () => {
    await chrome.storage.local.set({ [SYNC_KEY]: { ...(await readSync()), ...patch } });
  });
}
