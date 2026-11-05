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

interface IconPlacement {
  width: number;
  height: number;
  offset: number;
}

interface TrackedVideo {
  button: VideoButton;
  source: string | null;
  loadedAt: number;
  placement: IconPlacement | null;
  visible: boolean;
  listeners: AbortController;
  media: PageVideo | null;
  fallback: string | null;
  thumbnail: string | null;
}

interface Manifest {
  url: string;
  key: string;
  at: number;
}

interface Placement {
  tracked: TrackedVideo;
  left: number;
  top: number;
}

interface TrackedInline {
  button: VideoButton;
  media: PageVideo | null;
}

const TAKEOVER_EVENT = 'pkaf-video-takeover';
const MAX_OVERLAYS = 40;
const MAX_THUMBNAILS = 24;
const MAX_MANIFESTS = 50;
const MANIFEST_LEAD_MS = 2_000;
const MAX_INLINE = 30;
const MIN_WIDTH = 160;
const MIN_HEIGHT = 90;
const ICON_SIZE = 32;
const ICON_INSET = 10;
const PLACEMENT_STEP = 24;
const PLACEMENT_TRIES = 8;
const CHILDLESS_TAGS = new Set(['VIDEO', 'AUDIO', 'IMG', 'PICTURE', 'CANVAS', 'IFRAME', 'SVG', 'INPUT', 'SOURCE']);
const SCAN_DEBOUNCE_MS = 800;
const SCAN_MAX_WAIT_MS = 3_000;
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
let scanPendingSince = 0;
let declarationsChanged = false;
let reportTimer: number | undefined;
let lastReport = '';
let frame = 0;
let active = false;
let showUnavailable = false;
let streamsAllowed = false;
let manifestObserver: PerformanceObserver | null = null;
const manifests: Manifest[] = [];
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

function extensionAlive(): boolean {
  return Boolean(chrome.runtime && chrome.runtime.id);
}

function manifestKey(name: string): string {
  const url = new URL(name);
  return `${url.origin}${url.pathname}`;
}

function rememberManifests(entries: PerformanceEntry[]): boolean {
  let added = false;
  for (const entry of entries) {
    if (!isManifest(entry.name)) {
      continue;
    }
    const key = manifestKey(entry.name);
    if (manifests.some((item) => item.key === key)) {
      continue;
    }
    manifests.push({ url: entry.name, key, at: entry.startTime });
    added = true;
  }
  if (manifests.length > MAX_MANIFESTS) {
    manifests.splice(0, manifests.length - MAX_MANIFESTS);
  }
  return added;
}

function reevaluateStreamed(): void {
  for (const [element, tracked] of videos) {
    if (tracked.thumbnail || !(element instanceof HTMLVideoElement)) {
      continue;
    }
    evaluate(element, tracked);
  }
}

function watchManifests(): void {
  if (manifestObserver || !streamsAllowed || typeof PerformanceObserver === 'undefined') {
    return;
  }
  rememberManifests(performance.getEntriesByType('resource'));
  manifestObserver = new PerformanceObserver((list) => {
    if (rememberManifests(list.getEntries())) {
      reevaluateStreamed();
    }
  });
  manifestObserver.observe({ type: 'resource', buffered: true });
}

function stopManifests(): void {
  if (manifestObserver) {
    manifestObserver.disconnect();
  }
  manifestObserver = null;
}

function manifestSince(loadedAt: number): string | null {
  const recent = manifests.find((item) => item.at >= loadedAt - MANIFEST_LEAD_MS);
  if (recent) {
    return recent.url;
  }
  const [first] = manifests;
  if (!first) {
    return null;
  }
  return first.url;
}

function streamFor(sources: string[], loadedAt: number): string | null {
  if (!streamsAllowed) {
    return null;
  }
  const own = sources.find((source) => isManifest(source));
  if (own) {
    return own;
  }
  const [declared] = declaredOnPage();
  if (declared) {
    return declared;
  }
  return manifestSince(loadedAt);
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
  const streamed = sources.map((source) => sourceKind(source, location.href)).find((kind) => kind === 'blob' || kind === 'streaming');
  const direct = declared ?? playableCandidate(sources);
  const stream = !direct && streamed ? streamFor(sources, tracked.loadedAt) : null;
  const signature = [declared, stream, ...sources].filter(Boolean).join('|') || null;
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

function cachedIconTop(element: Element, tracked: TrackedVideo, rect: DOMRect): number {
  const placement = tracked.placement;
  if (placement && placement.width === rect.width && placement.height === rect.height) {
    return rect.top + placement.offset;
  }
  const top = iconTop(element, rect);
  tracked.placement = { width: rect.width, height: rect.height, offset: top - rect.top };
  return top;
}

function styleOffset(value: string): number {
  const parsed = Number.parseFloat(value);
  if (Number.isFinite(parsed)) {
    return parsed;
  }
  return 0;
}

function measure(video: Element, tracked: TrackedVideo): Placement | null {
  const rect = video.getBoundingClientRect();
  if (rect.width < MIN_WIDTH || rect.height < MIN_HEIGHT) {
    return null;
  }
  const host = tracked.button.element;
  const current = host.getBoundingClientRect();
  const originLeft = current.left - styleOffset(host.style.left);
  const originTop = current.top - styleOffset(host.style.top);
  const left = rect.right - ICON_INSET - ICON_SIZE - originLeft;
  const top = cachedIconTop(video, tracked, rect) - originTop;
  return { tracked, left, top };
}

function wantsIcon(tracked: TrackedVideo): boolean {
  return tracked.visible && !document.fullscreenElement && isVideoButtonShown(tracked.button.state(), showUnavailable);
}

function position(): void {
  frame = 0;
  const shown: Array<[Element, TrackedVideo]> = [];
  for (const [video, tracked] of videos) {
    const show = wantsIcon(tracked);
    tracked.button.element.toggleAttribute('data-visible', show);
    if (show) {
      mount(video, tracked.button);
      shown.push([video, tracked]);
    }
  }
  const placements = shown.map(([video, tracked]) => measure(video, tracked));
  placements.forEach((placement, index) => {
    const [, tracked] = shown[index] as [Element, TrackedVideo];
    if (!placement) {
      tracked.button.element.toggleAttribute('data-visible', false);
      return;
    }
    tracked.button.element.style.left = `${Math.round(placement.left)}px`;
    tracked.button.element.style.top = `${Math.round(placement.top)}px`;
  });
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
    loadedAt: 0,
    placement: null,
    visible: false,
    listeners: new AbortController(),
    media: null,
    fallback: null,
    thumbnail: null,
  };
  videos.set(video, tracked);
  mount(video, button);
  video.addEventListener(
    'loadstart',
    () => {
      tracked.loadedAt = performance.now();
    },
    { signal: tracked.listeners.signal },
  );
  video.addEventListener('loadedmetadata', () => evaluate(video, tracked), { signal: tracked.listeners.signal });
  video.addEventListener(
    'resize',
    () => {
      tracked.placement = null;
    },
    { signal: tracked.listeners.signal },
  );
  intersection?.observe(video);
  evaluate(video, tracked);
}

function trackThumbnail(element: Element, url: string): void {
  const button = createVideoButton('overlay', schedulePosition);
  const tracked: TrackedVideo = {
    button,
    source: null,
    loadedAt: 0,
    placement: null,
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

function countTracked(thumbnails: boolean): number {
  let count = 0;
  for (const tracked of videos.values()) {
    if (Boolean(tracked.thumbnail) === thumbnails) {
      count += 1;
    }
  }
  return count;
}

function scanThumbnails(): void {
  const found = document.evaluate(THUMBNAIL_XPATH, document.body, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
  let thumbnails = countTracked(true);
  for (let index = 0; index < found.snapshotLength && thumbnails < MAX_THUMBNAILS; index += 1) {
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
      thumbnails += 1;
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

function scanVideos(): void {
  let count = countTracked(false);
  for (const video of document.querySelectorAll('video')) {
    if (count >= MAX_OVERLAYS) {
      break;
    }
    if (!videos.has(video) && !insideTrackedThumbnail(video)) {
      trackVideo(video);
      count += 1;
    }
  }
}

function scan(): void {
  scanPendingSince = 0;
  if (!extensionAlive()) {
    retired = true;
    deactivate();
    return;
  }
  forgetDetached();
  if (declarationsChanged) {
    declarationsChanged = false;
    reevaluateStreamed();
  }
  scanVideos();
  scanThumbnails();
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
  const now = Date.now();
  if (scanPendingSince === 0) {
    scanPendingSince = now;
  }
  if (now - scanPendingSince >= SCAN_MAX_WAIT_MS) {
    return;
  }
  window.clearTimeout(scanTimer);
  scanTimer = window.setTimeout(scan, SCAN_DEBOUNCE_MS);
}

function resetForNavigation(): void {
  manifests.length = 0;
  lastReport = '';
  scheduleReport();
  scheduleScan();
}

function onPageShow(event: PageTransitionEvent): void {
  if (!event.persisted) {
    return;
  }
  lastReport = '';
  scheduleReport();
}

function onNavigate(event: Event): void {
  const destination = (event as Event & { destination?: { url?: string } }).destination;
  if (destination && destination.url && destination.url !== location.href) {
    window.setTimeout(resetForNavigation, 0);
  }
}

function navigationTarget(): EventTarget | null {
  const holder = window as Window & { navigation?: EventTarget };
  if (!holder.navigation) {
    return null;
  }
  return holder.navigation;
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
  window.addEventListener('pageshow', onPageShow);
  document.addEventListener('fullscreenchange', schedulePosition);
  const navigation = navigationTarget();
  if (navigation) {
    navigation.addEventListener('navigate', onNavigate);
  }
  scan();
}

function deactivate(): void {
  stopManifests();
  if (!active) {
    return;
  }
  active = false;
  if (observer) {
    observer.disconnect();
  }
  if (intersection) {
    intersection.disconnect();
  }
  observer = null;
  intersection = null;
  window.clearTimeout(scanTimer);
  scanPendingSince = 0;
  window.removeEventListener('scroll', schedulePosition, { capture: true });
  window.removeEventListener('resize', schedulePosition);
  window.removeEventListener('pageshow', onPageShow);
  document.removeEventListener('fullscreenchange', schedulePosition);
  const navigation = navigationTarget();
  if (navigation) {
    navigation.removeEventListener('navigate', onNavigate);
  }
  for (const [video, tracked] of videos) {
    forgetVideo(video, tracked);
  }
  for (const tracked of inline.values()) {
    tracked.button.remove();
  }
  inline.clear();
  usedFallbacks.clear();
  window.clearTimeout(reportTimer);
  if (extensionAlive()) {
    report();
  }
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
      if (extensionAlive()) {
        return;
      }
      retired = true;
      deactivate();
      try {
        stopListening();
      } catch {
        return;
      }
    },
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
