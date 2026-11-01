import { isHidden } from '../core/filter';
import { DEFAULT_SETTINGS } from '../core/settings';
import type { CheckResult, DisplayStatus, Settings } from '../core/types';
import { sendRequest } from '../shared/messaging';
import { loadSettings, onRefreshRequested, onSettingsChanged, saveSettings } from '../shared/storage';
import { decorateVideoResult } from './google-videos';
import { createHiddenNotice, NOTICE_TAG } from './hidden-notice';
import { claimResults, releaseAll, type SearchResult } from './result-detector';
import { setHidden, unhideAll } from './result-filter';
import { createIndicator, hideTooltip, INDICATOR_TAG, TOOLTIP_TAG, type Indicator } from './status-indicator';
import { VIDEO_BUTTON_TAG, type VideoButton } from './video-button';

interface TrackedResult {
  result: SearchResult;
  container: HTMLElement;
  domain: string;
  indicator: Indicator;
  status: DisplayStatus;
  video: VideoButton | null;
}

const SCAN_DEBOUNCE_MS = 400;
const OWN_TAGS = new Set([INDICATOR_TAG, NOTICE_TAG, TOOLTIP_TAG, VIDEO_BUTTON_TAG].map((tag) => tag.toUpperCase()));

const tracked: TrackedResult[] = [];
const notice = createHiddenNotice(() => void saveSettings({ filterMode: 'all' }));
let settings: Settings = DEFAULT_SETTINGS;
let observer: MutationObserver | null = null;
let scanTimer: number | undefined;

function applyFilter(): void {
  let hiddenCount = 0;
  for (const entry of tracked) {
    const hidden = isHidden(entry.status, settings);
    setHidden(entry.container, hidden);
    if (hidden) hiddenCount += 1;
  }
  notice.update(hiddenCount);
}

function applyResults(results: Record<string, CheckResult>): void {
  for (const entry of tracked) {
    const result = results[entry.domain];
    if (!result || !entry.container.isConnected) continue;
    entry.status = result.status;
    entry.indicator.update(result.status, result);
  }
  applyFilter();
}

function videosWanted(): boolean {
  return settings.videoDownloader && settings.videoOnGoogle;
}

function refreshVideos(): void {
  for (const entry of tracked) {
    entry.video?.remove();
    entry.video = videosWanted() ? decorateVideoResult(entry.result) : null;
  }
}

async function check(domains: string[]): Promise<void> {
  if (domains.length === 0) return;
  const cached = await sendRequest({ type: 'lookup', domains });
  if (cached) applyResults(cached.results);
  const missing = domains.filter((domain) => !cached?.results[domain]);
  if (missing.length === 0) return;
  const response = await sendRequest({ type: 'check', domains: missing });
  if (response) applyResults(response.results);
}

function scan(): void {
  for (let index = tracked.length - 1; index >= 0; index -= 1) {
    if (!tracked[index]?.container.isConnected) tracked.splice(index, 1);
  }
  const found = claimResults(document, location.origin);
  for (const result of found) {
    const indicator = createIndicator();
    indicator.update('checking', null);
    result.heading.append(indicator.element);
    const video = videosWanted() ? decorateVideoResult(result) : null;
    tracked.push({ result, container: result.container, domain: result.domain, indicator, status: 'checking', video });
  }
  void check([...new Set(found.map((result) => result.domain))]);
}

function scheduleScan(): void {
  window.clearTimeout(scanTimer);
  scanTimer = window.setTimeout(scan, SCAN_DEBOUNCE_MS);
}

function isOwnMutation(mutation: MutationRecord): boolean {
  return [...mutation.addedNodes].every((node) => OWN_TAGS.has(node.nodeName));
}

function startObserving(): void {
  observer = new MutationObserver((mutations) => {
    if (mutations.some((mutation) => !isOwnMutation(mutation))) scheduleScan();
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

function teardown(): void {
  observer?.disconnect();
  observer = null;
  window.clearTimeout(scanTimer);
  for (const entry of tracked) {
    entry.indicator.remove();
    entry.video?.remove();
  }
  tracked.length = 0;
  hideTooltip();
  notice.remove();
  unhideAll(document);
  releaseAll(document);
}

function activate(): void {
  scan();
  startObserving();
}

function recheckAll(): void {
  if (!settings.enabled) return;
  for (const entry of tracked) {
    entry.status = 'checking';
    entry.indicator.update('checking', null);
  }
  applyFilter();
  void check([...new Set(tracked.map((entry) => entry.domain))]);
}

async function start(): Promise<void> {
  settings = await loadSettings();
  if (settings.enabled) activate();
  onSettingsChanged((next) => {
    const previous = settings;
    settings = next;
    if (!next.enabled) teardown();
    else if (!previous.enabled) activate();
    else {
      applyFilter();
      if (previous.videoDownloader !== next.videoDownloader || previous.videoOnGoogle !== next.videoOnGoogle) refreshVideos();
    }
  });
  onRefreshRequested(recheckAll);
}

void start();
