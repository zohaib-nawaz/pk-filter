import { AUTO_COUNTRY, isCountryCode } from '../core/countries';
import type { ViewerCountry } from '../core/types';
import { loadSettings, requestRefresh } from '../shared/storage';
import { browserCountry, whereAmI } from './api-client';

const VIEWER_KEY = 'viewer';
const FRESH_MS = 60_000;
let memo: { choice: string; viewer: ViewerCountry; at: number } | null = null;
let pending: Promise<ViewerCountry> | null = null;

export async function storedViewer(): Promise<ViewerCountry | null> {
  const stored = await chrome.storage.local.get(VIEWER_KEY);
  const viewer = stored[VIEWER_KEY] as ViewerCountry | undefined;
  if (!viewer || !isCountryCode(viewer.country)) {
    return null;
  }
  return viewer;
}

function fallbackFor(choice: string, previous: ViewerCountry | null): ViewerCountry {
  if (choice !== AUTO_COUNTRY) {
    return { country: choice, source: 'chosen', measuredBy: 'ooni' };
  }
  if (previous) {
    return previous;
  }
  return { country: AUTO_COUNTRY, source: 'default', measuredBy: 'ooni' };
}

async function detect(choice: string): Promise<ViewerCountry | null> {
  const fromServer = await whereAmI(choice);
  if (choice !== AUTO_COUNTRY || (fromServer && fromServer.source !== 'default')) {
    return fromServer;
  }
  const local = await browserCountry();
  if (!local) {
    return fromServer;
  }
  const confirmed = await whereAmI(local);
  if (confirmed) {
    return { ...confirmed, source: 'ip' };
  }
  return { country: local, source: 'ip', measuredBy: 'ooni' };
}

async function resolve(choice: string): Promise<ViewerCountry> {
  const previous = await storedViewer();
  const found = await detect(choice);
  const viewer = found ? found : fallbackFor(choice, previous);
  memo = { choice, viewer, at: Date.now() };
  await chrome.storage.local.set({ [VIEWER_KEY]: viewer });
  if (previous && previous.country !== viewer.country) {
    await requestRefresh();
  }
  return viewer;
}

export async function currentViewer(force = false): Promise<ViewerCountry> {
  const { country: choice } = await loadSettings();
  if (!force && memo && memo.choice === choice && Date.now() - memo.at < FRESH_MS) {
    return memo.viewer;
  }
  if (!pending) {
    pending = resolve(choice).finally(() => {
      pending = null;
    });
  }
  return pending;
}
