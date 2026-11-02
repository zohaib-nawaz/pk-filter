import { matchesStreamDomain } from '../core/hls';
import { describeSource, extensionFromPath, MEDIA_LINK_EXTENSIONS, safeHttpUrl, sourceKind } from '../core/media';
import { isVideoButtonShown } from '../core/video-visibility';
import type { MediaInfo, PageVideo, Settings } from '../core/types';
import { sendRequest } from '../shared/messaging';
import { loadSettings, onSettingsChanged } from '../shared/storage';
import { linkTitle, mediaTitle } from './media-title';
import { metadataMediaSources } from './page-metadata';
import { declaredForElement, declaredOnPage, DOWNLOAD_ATTRIBUTE } from './site-declarations';
import { prepareDownload } from './video-actions';
import { createVideoButton, VIDEO_BUTTON_TAG, type VideoButton } from './video-button';

interface TrackedVideo {
  button: VideoButton;
  source: string | null;
  visible: boolean;
  listeners: AbortController;
  media: PageVideo | null;
  fallback: string | null;
  thumbnail: string | null;
}

interface TrackedInline {
  button: VideoButton;
  media: PageVideo | null;
}

const TAKEOVER_EVENT = 'pkaf-video-takeover';
const MAX_OVERLAYS = 40;
const MAX_INLINE = 30;
const MIN_WIDTH = 160;
const MIN_HEIGHT = 90;
const ICON_SIZE = 32;
const ICON_INSET = 10;
const PLACEMENT_STEP = 24;
const PLACEMENT_TRIES = 8;
const CHILDLESS_TAGS = new Set(['VIDEO', 'AUDIO', 'IMG', 'PICTURE', 'CANVAS', 'IFRAME', 'SVG', 'INPUT', 'SOURCE']);
const SCAN_DEBOUNCE_MS = 800;
const REPORT_DEBOUNCE_MS = 300;
const LINK_SELECTOR = MEDIA_LINK_EXTENSIONS.flatMap((ext) => [`a[href$=".${ext}" i]`, `a[href*=".${ext}?" i]`]).join(',');
const THUMBNAIL_XPATH = `//*[@*[${MEDIA_LINK_EXTENSIONS.map((ext) => `contains(., '.${ext}')`).join(' or ')}]]`;
const NOT_THUMBNAILS = new Set(['A', 'VIDEO', 'AUDIO', 'SOURCE', 'META', 'LINK', 'SCRIPT', 'IFRAME', 'TRACK']);

const videos = new Map<Element, TrackedVideo>();
const inline = new Map<Element, TrackedInline>();
const usedFallbacks = new Set<string>();
let observer: MutationObserver | null = null;
let intersection: IntersectionObserver | null = null;
let scanTimer: number | undefined;
let declarationsChanged = false;
let reportTimer: number | undefined;
let lastReport = '';
let frame = 0;
let active = false;
let showUnavailable = false;
let streamsAllowed = false;
let manifestObserver: PerformanceObserver | null = null;
const manifests: string[] = [];
let retired = false;

function isWanted(settings: Settings): boolean {
  return settings.videoDownloader && settings.videoOnPages;
}

function mediaSources(element: HTMLMediaElement): string[] {
  const sources = [element.currentSrc, element.src, ...[...element.querySelectorAll('source')].map((source) => source.src)];
  return [...new Set(sources.filter(Boolean))];
}

function playableCandidate(sources: string[]): string | null {
  const kinds = sources.map((source) => ({ source, kind: sourceKind(source, location.href) }));
  const candidate = kinds.find((item) => item.kind === 'direct') ?? kinds.find((item) => item.kind === 'unknown');
  return candidate ? new URL(candidate.source, location.href).toString() : null;
}

function isManifest(name: string): boolean {
  const url = safeHttpUrl(name);
  const extension = url ? extensionFromPath(url) : null;
  return extension === 'm3u8' || extension === 'mpd';
}

function rememberManifests(names: string[]): boolean {
  let added = false;
  for (const name of names) {
    if (!isManifest(name) || manifests.includes(name)) {
      continue;
    }
    manifests.push(name);
    added = true;
  }
  return added;
}

function reevaluateStreamed(): void {
  for (const [element, tracked] of videos) {
    if (tracked.thumbnail || !(element instanceof HTMLVideoElement)) {
      continue;
    }
    tracked.source = null;
    evaluate(element, tracked);
  }
}

function watchManifests(): void {
  if (manifestObserver || !streamsAllowed || typeof PerformanceObserver === 'undefined') {
    return;
  }
  rememberManifests(performance.getEntriesByType('resource').map((entry) => entry.name));
  manifestObserver = new PerformanceObserver((list) => {
    if (rememberManifests(list.getEntries().map((entry) => entry.name))) {
      reevaluateStreamed();
    }
  });
  manifestObserver.observe({ type: 'resource', buffered: true });
}

function stopManifests(): void {
  manifestObserver?.disconnect();
  manifestObserver = null;
}

function streamFor(sources: string[]): string | null {
  if (!streamsAllowed) {
    return null;
  }
  const own = sources.find((source) => isManifest(source));
  return own ?? declaredOnPage()[0] ?? manifests[0] ?? null;
}

function pickFallback(tracked: TrackedVideo): string | null {
  const available = metadataMediaSources();
  if (tracked.fallback && available.includes(tracked.fallback)) {
    return tracked.fallback;
  }
  const next = available.find((url) => !usedFallbacks.has(url)) ?? null;
  if (next) {
    usedFallbacks.add(next);
  }
  return next;
}

function toPageVideo(info: MediaInfo | null, title: string): PageVideo | null {
  if (!info?.extension) {
    return null;
  }
  return { url: info.url, title, extension: info.extension, sizeBytes: info.sizeBytes };
}

function report(): void {
  const found = new Map<string, PageVideo>();
  for (const item of [...videos.values(), ...inline.values()]) {
    if (item.media && !found.has(item.media.url)) {
      found.set(item.media.url, item.media);
    }
  }
  const list = [...found.values()];
  const signature = list.map((video) => video.url).join('|');
  if (signature === lastReport) {
    return;
  }
  lastReport = signature;
  void sendRequest({ type: 'page-videos', videos: list });
}

function scheduleReport(): void {
  window.clearTimeout(reportTimer);
  reportTimer = window.setTimeout(report, REPORT_DEBOUNCE_MS);
}

function otherMediaThan(self: Element): (candidate: Element) => boolean {
  return (candidate) =>
    [...videos.keys(), ...inline.keys()].some((tracked) => tracked !== self && (tracked === candidate || tracked.contains(candidate)));
}

function qualityRank(name: string): number {
  if (/large|hd|high|full|original/i.test(name)) {
    return 3;
  }
  if (/medium/i.test(name)) {
    return 2;
  }
  if (/small|thumb|preview|low/i.test(name)) {
    return 0;
  }
  return 1;
}

function thumbnailSource(element: Element): string | null {
  const candidates = [...element.attributes]
    .filter((attribute) => attribute.name.startsWith('data-') && sourceKind(attribute.value.trim(), location.href) === 'direct')
    .sort((a, b) => qualityRank(b.name) - qualityRank(a.name));
  const best = candidates[0];
  return best ? new URL(best.value.trim(), location.href).toString() : null;
}

function insideTrackedThumbnail(element: Element): boolean {
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    if (videos.get(parent)?.thumbnail) {
      return true;
    }
  }
  return false;
}

function inspectThumbnail(element: Element, tracked: TrackedVideo): void {
  if (!tracked.thumbnail || tracked.source === tracked.thumbnail) {
    return;
  }
  const url = tracked.thumbnail;
  tracked.source = url;
  const title = mediaTitle(element, url, otherMediaThan(element));
  void prepareDownload(tracked.button, url, title).then((info) => {
    tracked.media = toPageVideo(info, title);
    scheduleReport();
  });
}

function evaluate(video: HTMLVideoElement, tracked: TrackedVideo): void {
  const sources = mediaSources(video);
  const declared = streamsAllowed ? declaredForElement(video) : null;
  const signature = (declared ? [declared, ...sources] : sources).join('|') || null;
  if (signature === tracked.source) {
    return;
  }
  tracked.source = signature;
  tracked.media = null;
  scheduleReport();
  if (video.mediaKeys) {
    tracked.button.set('unavailable', 'This video is DRM-protected and cannot be downloaded');
    return;
  }
  const streamed = sources.map((source) => sourceKind(source, location.href)).find((kind) => kind === 'blob' || kind === 'streaming');
  const direct = declared ?? playableCandidate(sources);
  const stream = !direct && streamed ? streamFor(sources) : null;
  if (!direct && !stream && streamed) {
    tracked.fallback = pickFallback(tracked);
  }
  const url = direct ?? stream ?? (streamed ? tracked.fallback : null);
  if (!url) {
    tracked.button.set('unavailable', describeSource(streamed ?? 'invalid'));
    return;
  }
  const title = mediaTitle(video, url, otherMediaThan(video));
  const viaFallback = url === tracked.fallback;
  void prepareDownload(tracked.button, url, title).then((info) => {
    if (tracked.source !== signature) {
      return;
    }
    tracked.media = toPageVideo(info, title);
    if (!info && viaFallback && streamed) {
      tracked.button.set('unavailable', describeSource(streamed));
    }
    scheduleReport();
  });
}

function isUncovered(element: Element, x: number, y: number): boolean {
  const topmost = document.elementsFromPoint(x, y).find((node) => node.tagName !== VIDEO_BUTTON_TAG.toUpperCase());
  return !!topmost && (topmost === element || element.contains(topmost));
}

function iconTop(element: Element, rect: DOMRect): number {
  const start = Math.max(rect.top, 0) + ICON_INSET;
  const x = rect.right - ICON_INSET - ICON_SIZE / 2;
  for (let attempt = 0; attempt < PLACEMENT_TRIES; attempt += 1) {
    const top = start + attempt * PLACEMENT_STEP;
    if (top + ICON_SIZE > rect.bottom) {
      break;
    }
    if (isUncovered(element, x, top + ICON_SIZE / 2)) {
      return top;
    }
  }
  return start;
}

function mountTarget(element: Element): Element {
  return CHILDLESS_TAGS.has(element.tagName.toUpperCase()) ? (element.parentElement ?? document.body) : element;
}

function mount(element: Element, button: VideoButton): void {
  const target = mountTarget(element);
  if (button.element.parentElement !== target) {
    target.append(button.element);
  }
}

function placeAt(button: VideoButton, left: number, top: number): void {
  const host = button.element;
  host.style.left = '0px';
  host.style.top = '0px';
  const origin = host.getBoundingClientRect();
  host.style.left = `${Math.round(left - origin.left)}px`;
  host.style.top = `${Math.round(top - origin.top)}px`;
}

function position(): void {
  frame = 0;
  for (const [video, tracked] of videos) {
    const rect = video.getBoundingClientRect();
    const show =
      tracked.visible &&
      rect.width >= MIN_WIDTH &&
      rect.height >= MIN_HEIGHT &&
      !document.fullscreenElement &&
      isVideoButtonShown(tracked.button.state(), showUnavailable);
    tracked.button.element.toggleAttribute('data-visible', show);
    if (!show) {
      continue;
    }
    mount(video, tracked.button);
    placeAt(tracked.button, rect.right - ICON_INSET - ICON_SIZE, iconTop(video, rect));
  }
}

function schedulePosition(): void {
  if (!frame) {
    frame = requestAnimationFrame(position);
  }
}

function trackVideo(video: HTMLVideoElement): void {
  const button = createVideoButton('overlay', schedulePosition);
  const tracked: TrackedVideo = {
    button,
    source: null,
    visible: false,
    listeners: new AbortController(),
    media: null,
    fallback: null,
    thumbnail: null,
  };
  videos.set(video, tracked);
  mount(video, button);
  video.addEventListener('loadedmetadata', () => evaluate(video, tracked), { signal: tracked.listeners.signal });
  intersection?.observe(video);
  evaluate(video, tracked);
}

function trackThumbnail(element: Element, url: string): void {
  const button = createVideoButton('overlay', schedulePosition);
  const tracked: TrackedVideo = {
    button,
    source: null,
    visible: false,
    listeners: new AbortController(),
    media: null,
    fallback: null,
    thumbnail: url,
  };
  videos.set(element, tracked);
  mount(element, button);
  intersection?.observe(element);
}

function scanThumbnails(): void {
  const found = document.evaluate(THUMBNAIL_XPATH, document.body, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
  for (let index = 0; index < found.snapshotLength && videos.size < MAX_OVERLAYS; index += 1) {
    const element = found.snapshotItem(index) as Element | null;
    if (!element || NOT_THUMBNAILS.has(element.tagName) || videos.has(element) || insideTrackedThumbnail(element)) {
      continue;
    }
    if ([...videos.keys()].some((tracked) => element.contains(tracked))) {
      continue;
    }
    const url = thumbnailSource(element);
    if (url) {
      trackThumbnail(element, url);
    }
  }
}

function applyInlineVisibility(button: VideoButton): void {
  button.element.style.display = isVideoButtonShown(button.state(), showUnavailable) ? '' : 'none';
}

function trackInline(element: Element, url: string, title: string): void {
  const button: VideoButton = createVideoButton('inline', () => applyInlineVisibility(button));
  applyInlineVisibility(button);
  const tracked: TrackedInline = { button, media: null };
  inline.set(element, tracked);
  element.insertAdjacentElement('afterend', button.element);
  void prepareDownload(button, url, title).then((info) => {
    tracked.media = toPageVideo(info, title);
    scheduleReport();
  });
}

function trackLink(link: HTMLAnchorElement): void {
  if (sourceKind(link.href) !== 'direct') {
    return;
  }
  trackInline(link, link.href, linkTitle(link, link.href, otherMediaThan(link)));
}

function trackAudio(audio: HTMLAudioElement): void {
  const url = playableCandidate(mediaSources(audio));
  if (url) {
    trackInline(audio, url, mediaTitle(audio, url, otherMediaThan(audio)));
  }
}

function forgetVideo(video: Element, tracked: TrackedVideo): void {
  tracked.listeners.abort();
  tracked.button.remove();
  intersection?.unobserve(video);
  if (tracked.fallback) {
    usedFallbacks.delete(tracked.fallback);
  }
  videos.delete(video);
  scheduleReport();
}

function forgetDetached(): void {
  for (const [video, tracked] of videos) {
    if (!video.isConnected) {
      forgetVideo(video, tracked);
    }
  }
  for (const [element, tracked] of inline) {
    if (element.isConnected) {
      continue;
    }
    tracked.button.remove();
    inline.delete(element);
    scheduleReport();
  }
}

function scan(): void {
  forgetDetached();
  if (declarationsChanged) {
    declarationsChanged = false;
    reevaluateStreamed();
  }
  scanThumbnails();
  for (const video of document.querySelectorAll('video')) {
    if (videos.size >= MAX_OVERLAYS) {
      break;
    }
    if (!videos.has(video) && !insideTrackedThumbnail(video)) {
      trackVideo(video);
    }
  }
  for (const audio of document.querySelectorAll('audio')) {
    if (inline.size >= MAX_INLINE) {
      break;
    }
    if (!inline.has(audio)) {
      trackAudio(audio);
    }
  }
  for (const link of document.querySelectorAll<HTMLAnchorElement>(LINK_SELECTOR)) {
    if (inline.size >= MAX_INLINE) {
      break;
    }
    if (!inline.has(link)) {
      trackLink(link);
    }
  }
  schedulePosition();
}

function scheduleScan(): void {
  window.clearTimeout(scanTimer);
  scanTimer = window.setTimeout(scan, SCAN_DEBOUNCE_MS);
}

function isOwnMutation(mutation: MutationRecord): boolean {
  return [...mutation.addedNodes, ...mutation.removedNodes].every((node) => node.nodeName === VIDEO_BUTTON_TAG.toUpperCase());
}

function activate(): void {
  if (active || retired) {
    return;
  }
  active = true;
  intersection = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      const tracked = videos.get(entry.target);
      if (!tracked) {
        continue;
      }
      tracked.visible = entry.isIntersecting;
      if (entry.isIntersecting) {
        inspectThumbnail(entry.target, tracked);
      }
    }
    schedulePosition();
  });
  observer = new MutationObserver((mutations) => {
    const declarations = mutations.some((mutation) => mutation.type === 'attributes');
    if (declarations) {
      declarationsChanged = true;
    }
    if (declarations || mutations.some((mutation) => !isOwnMutation(mutation))) {
      scheduleScan();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: [DOWNLOAD_ATTRIBUTE] });
  window.addEventListener('scroll', schedulePosition, { passive: true, capture: true });
  window.addEventListener('resize', schedulePosition, { passive: true });
  document.addEventListener('fullscreenchange', schedulePosition);
  scan();
}

function deactivate(): void {
  stopManifests();
  if (!active) {
    return;
  }
  active = false;
  observer?.disconnect();
  intersection?.disconnect();
  observer = null;
  intersection = null;
  window.clearTimeout(scanTimer);
  window.removeEventListener('scroll', schedulePosition, { capture: true });
  window.removeEventListener('resize', schedulePosition);
  document.removeEventListener('fullscreenchange', schedulePosition);
  for (const [video, tracked] of videos) {
    forgetVideo(video, tracked);
  }
  for (const tracked of inline.values()) {
    tracked.button.remove();
  }
  inline.clear();
  usedFallbacks.clear();
  window.clearTimeout(reportTimer);
  report();
}

async function start(): Promise<void> {
  if (!document.body) {
    return;
  }
  document.dispatchEvent(new CustomEvent(TAKEOVER_EVENT));
  let stopListening = () => {};
  document.addEventListener(
    TAKEOVER_EVENT,
    () => {
      retired = true;
      deactivate();
      try {
        stopListening();
      } catch {
        return;
      }
    },
    { once: true },
  );
  const applySettings = (settings: Settings) => {
    showUnavailable = settings.videoShowUnavailable;
    const allowStreams = matchesStreamDomain(location.hostname, settings.streamDomains);
    const streamsChanged = allowStreams !== streamsAllowed;
    streamsAllowed = allowStreams;
    if (!isWanted(settings)) {
      deactivate();
      return;
    }
    const wasActive = active;
    if (streamsAllowed) {
      watchManifests();
    } else {
      stopManifests();
    }
    activate();
    if (streamsChanged && wasActive) {
      reevaluateStreamed();
    }
    for (const tracked of inline.values()) {
      applyInlineVisibility(tracked.button);
    }
    schedulePosition();
  };
  applySettings(await loadSettings());
  stopListening = onSettingsChanged(applySettings);
}

void start();
