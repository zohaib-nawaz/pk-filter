import { chunk } from '../core/cache-policy';
import { isHidden, isMeasured } from '../core/filter';
import { effectiveResult } from '../core/networks';
import { DEFAULT_SETTINGS } from '../core/settings';
import type { CheckResult, DisplayStatus, Settings } from '../core/types';
import { sendRequest } from '../shared/messaging';
import { loadSettings, onRefreshRequested, onSettingsChanged, saveSettings } from '../shared/storage';
import { decorateVideoResult } from './google-videos';
import { createHiddenNotice, NOTICE_TAG } from './hidden-notice';
import { claimResults, releaseAll, type SearchResult } from './result-detector';
import { setHidden, unhideAll } from './result-filter';
import { engineFor, type SearchEngine } from './search-engines';
import { createIndicator, hideTooltip, INDICATOR_TAG, TOOLTIP_TAG, type Indicator } from './status-indicator';
import { VIDEO_BUTTON_TAG, type VideoButton } from './video-button';

interface TrackedResult {
  result: SearchResult;
  container: HTMLElement;
  domain: string;
  indicator: Indicator;
  status: DisplayStatus;
  raw: CheckResult | null;
  video: VideoButton | null;
}

const SCAN_DEBOUNCE_MS = 400;
const SCAN_MAX_WAIT_MS = 2_000;
const CHECK_BATCH = 50;
const RECHECK_DELAY_MS = 20_000;
const MAX_RECHECKS = 5;
const OWN_TAGS = new Set([INDICATOR_TAG, NOTICE_TAG, TOOLTIP_TAG, VIDEO_BUTTON_TAG].map((tag) => tag.toUpperCase()));

const tracked: TrackedResult[] = [];
let settings: Settings = DEFAULT_SETTINGS;
let observer: MutationObserver | null = null;
let scanTimer: number | undefined;
let scanPendingSince = 0;
let recheckTimer: number | undefined;
let rechecks = 0;

function extensionAlive(): boolean {
  return Boolean(chrome.runtime && chrome.runtime.id);
}

function applyFilter(notice: ReturnType<typeof createHiddenNotice>): void {
  let hiddenCount = 0;
  for (const entry of tracked) {
    const hidden = isMeasured(entry.raw) && isHidden(entry.status, settings);
    setHidden(entry.container, hidden);
    if (hidden) {
      hiddenCount += 1;
    }
  }
  notice.update(hiddenCount);
}

function show(entry: TrackedResult): void {
  if (!entry.raw) {
    return;
  }
  const shown = effectiveResult(entry.raw, settings.preferredIsp);
  entry.status = shown.status;
  entry.indicator.update(shown.status, shown);
}

function videosWanted(): boolean {
  return settings.videoDownloader && settings.videoOnGoogle;
}

function decorate(entry: Pick<TrackedResult, 'result'>): VideoButton | null {
  if (!videosWanted()) {
    return null;
  }
  return decorateVideoResult(entry.result, settings.videoShowUnavailable);
}

function refreshVideos(): void {
  for (const entry of tracked) {
    if (entry.video) {
      entry.video.remove();
    }
    entry.video = decorate(entry);
  }
}

function markUnanswered(domains: string[]): void {
  const asked = new Set(domains);
  for (const entry of tracked) {
    if (asked.has(entry.domain) && entry.status === 'checking') {
      entry.status = 'unknown';
      entry.indicator.update('unknown', null);
    }
  }
}

function unmeasuredDomains(): string[] {
  const domains = tracked.filter((entry) => entry.status !== 'checking' && !isMeasured(entry.raw)).map((entry) => entry.domain);
  return [...new Set(domains)];
}

function run(engine: SearchEngine): void {
  const notice = createHiddenNotice(() => void saveSettings({ filterMode: 'all' }), () => engine.noticeAnchor());

  const applyResults = (results: Record<string, CheckResult>) => {
    for (const entry of tracked) {
      const result = results[entry.domain];
      if (!result || !entry.container.isConnected) {
        continue;
      }
      entry.raw = result;
      show(entry);
    }
    applyFilter(notice);
  };

  const checkBatch = async (domains: string[]) => {
    const cached = await sendRequest({ type: 'lookup', domains });
    const known = cached ? cached.results : {};
    applyResults(known);
    const missing = domains.filter((domain) => !known[domain]);
    if (missing.length === 0) {
      return;
    }
    const response = await sendRequest({ type: 'check', domains: missing });
    if (response) {
      applyResults(response.results);
    }
  };

  const scheduleRecheck = () => {
    if (recheckTimer !== undefined || rechecks >= MAX_RECHECKS || unmeasuredDomains().length === 0) {
      return;
    }
    recheckTimer = window.setTimeout(() => {
      recheckTimer = undefined;
      rechecks += 1;
      void check(unmeasuredDomains());
    }, RECHECK_DELAY_MS);
  };

  const check = async (domains: string[]) => {
    if (domains.length === 0) {
      return;
    }
    if (!extensionAlive()) {
      teardown();
      return;
    }
    await Promise.all(chunk(domains, CHECK_BATCH).map(checkBatch));
    markUnanswered(domains);
    applyFilter(notice);
    scheduleRecheck();
  };

  const scan = () => {
    scanPendingSince = 0;
    if (!extensionAlive()) {
      teardown();
      return;
    }
    for (let index = tracked.length - 1; index >= 0; index -= 1) {
      if (!tracked[index]?.container.isConnected) {
        tracked.splice(index, 1);
      }
    }
    const found = claimResults(document, location.origin, engine);
    for (const result of found) {
      const indicator = createIndicator();
      indicator.update('checking', null);
      result.heading.append(indicator.element);
      tracked.push({ result, container: result.container, domain: result.domain, indicator, status: 'checking', raw: null, video: decorate({ result }) });
    }
    void check([...new Set(found.map((result) => result.domain))]);
  };

  const scheduleScan = () => {
    const now = Date.now();
    if (scanPendingSince === 0) {
      scanPendingSince = now;
    }
    if (now - scanPendingSince >= SCAN_MAX_WAIT_MS) {
      return;
    }
    window.clearTimeout(scanTimer);
    scanTimer = window.setTimeout(scan, SCAN_DEBOUNCE_MS);
  };

  const isOwnMutation = (mutation: MutationRecord) => [...mutation.addedNodes].every((node) => OWN_TAGS.has(node.nodeName));

  const activate = () => {
    scan();
    observer = new MutationObserver((mutations) => {
      if (mutations.some((mutation) => !isOwnMutation(mutation))) {
        scheduleScan();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  };

  function teardown() {
    if (observer) {
      observer.disconnect();
    }
    observer = null;
    window.clearTimeout(scanTimer);
    window.clearTimeout(recheckTimer);
    recheckTimer = undefined;
    scanPendingSince = 0;
    for (const entry of tracked) {
      entry.indicator.remove();
      if (entry.video) {
        entry.video.remove();
      }
    }
    tracked.length = 0;
    hideTooltip();
    notice.remove();
    unhideAll(document);
    releaseAll(document);
  }

  const recheckAll = () => {
    if (!settings.enabled) {
      return;
    }
    rechecks = 0;
    for (const entry of tracked) {
      entry.status = 'checking';
      entry.raw = null;
      entry.indicator.update('checking', null);
    }
    applyFilter(notice);
    void check([...new Set(tracked.map((entry) => entry.domain))]);
  };

  const onSettings = (next: Settings) => {
    const previous = settings;
    settings = next;
    if (!next.enabled) {
      teardown();
      return;
    }
    if (!previous.enabled) {
      activate();
      return;
    }
    if (previous.preferredIsp !== next.preferredIsp) {
      tracked.forEach(show);
    }
    applyFilter(notice);
    const videoChanged =
      previous.videoDownloader !== next.videoDownloader ||
      previous.videoOnGoogle !== next.videoOnGoogle ||
      previous.videoShowUnavailable !== next.videoShowUnavailable;
    if (videoChanged) {
      refreshVideos();
    }
  };

  if (settings.enabled) {
    activate();
  }
  onSettingsChanged(onSettings);
  onRefreshRequested(recheckAll);
}

async function start(): Promise<void> {
  const engine = engineFor(location.hostname);
  if (!engine) {
    return;
  }
  settings = await loadSettings();
  run(engine);
}

void start();
