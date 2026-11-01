import { describeSource, MEDIA_LINK_EXTENSIONS, sourceKind } from '../core/media';
import { titleFromUrl } from '../core/filename';
import { isVideoButtonShown } from '../core/video-visibility';
import type { MediaInfo, PageVideo, Settings } from '../core/types';
import { sendRequest } from '../shared/messaging';
import { loadSettings, onSettingsChanged } from '../shared/storage';
import { metadataMediaSources } from './page-metadata';
import { prepareDownload } from './video-actions';
import { createVideoButton, VIDEO_BUTTON_TAG, type VideoButton } from './video-button';

interface TrackedVideo {
  button: VideoButton;
  source: string | null;
  visible: boolean;
  listeners: AbortController;
  media: PageVideo | null;
  fallback: string | null;
}

interface TrackedInline {
  button: VideoButton;
  media: PageVideo | null;
}

const TAKEOVER_EVENT = 'pkaf-video-takeover';
const MAX_VIDEOS = 12;
const MAX_INLINE = 30;
const MIN_WIDTH = 160;
const MIN_HEIGHT = 90;
const SCAN_DEBOUNCE_MS = 800;
const REPORT_DEBOUNCE_MS = 300;
const LINK_SELECTOR = MEDIA_LINK_EXTENSIONS.flatMap((ext) => [`a[href$=".${ext}" i]`, `a[href*=".${ext}?" i]`]).join(',');

const videos = new Map<HTMLVideoElement, TrackedVideo>();
const inline = new Map<Element, TrackedInline>();
const usedFallbacks = new Set<string>();
let observer: MutationObserver | null = null;
let intersection: IntersectionObserver | null = null;
let scanTimer: number | undefined;
let reportTimer: number | undefined;
let lastReport = '';
let frame = 0;
let active = false;
let showUnavailable = false;
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

function pickFallback(tracked: TrackedVideo): string | null {
  const available = metadataMediaSources();
  if (tracked.fallback && available.includes(tracked.fallback)) return tracked.fallback;
  const next = available.find((url) => !usedFallbacks.has(url)) ?? null;
  if (next) usedFallbacks.add(next);
  return next;
}

function toPageVideo(info: MediaInfo | null, title: string): PageVideo | null {
  if (!info?.extension) return null;
  return { url: info.url, title, extension: info.extension, sizeBytes: info.sizeBytes };
}

function report(): void {
  const found = new Map<string, PageVideo>();
  for (const item of [...videos.values(), ...inline.values()]) {
    if (item.media && !found.has(item.media.url)) found.set(item.media.url, item.media);
  }
  const list = [...found.values()];
  const signature = list.map((video) => video.url).join('|');
  if (signature === lastReport) return;
  lastReport = signature;
  void sendRequest({ type: 'page-videos', videos: list });
}

function scheduleReport(): void {
  window.clearTimeout(reportTimer);
  reportTimer = window.setTimeout(report, REPORT_DEBOUNCE_MS);
}

function evaluate(video: HTMLVideoElement, tracked: TrackedVideo): void {
  const sources = mediaSources(video);
  const signature = sources.join('|') || null;
  if (signature === tracked.source) return;
  tracked.source = signature;
  tracked.media = null;
  scheduleReport();
  if (video.mediaKeys) {
    tracked.button.set('unavailable', 'This video is DRM-protected and cannot be downloaded');
    return;
  }
  const streamed = sources.map((source) => sourceKind(source, location.href)).find((kind) => kind === 'blob' || kind === 'streaming');
  const direct = playableCandidate(sources);
  if (!direct && streamed) tracked.fallback = pickFallback(tracked);
  const url = direct ?? (streamed ? tracked.fallback : null);
  if (!url) {
    tracked.button.set('unavailable', describeSource(streamed ?? 'invalid'));
    return;
  }
  const title = document.title || titleFromUrl(url);
  void prepareDownload(tracked.button, url, title).then((info) => {
    if (tracked.source !== signature) return;
    tracked.media = toPageVideo(info, title);
    scheduleReport();
  });
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
    if (!show) continue;
    tracked.button.element.style.left = `${Math.round(rect.right - 44)}px`;
    tracked.button.element.style.top = `${Math.round(Math.max(rect.top, 0) + 10)}px`;
  }
}

function schedulePosition(): void {
  if (!frame) frame = requestAnimationFrame(position);
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
  };
  videos.set(video, tracked);
  document.body.append(button.element);
  video.addEventListener('loadedmetadata', () => evaluate(video, tracked), { signal: tracked.listeners.signal });
  intersection?.observe(video);
  evaluate(video, tracked);
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
  if (sourceKind(link.href) !== 'direct') return;
  trackInline(link, link.href, link.textContent?.trim() || titleFromUrl(link.href));
}

function trackAudio(audio: HTMLAudioElement): void {
  const url = playableCandidate(mediaSources(audio));
  if (url) trackInline(audio, url, document.title || titleFromUrl(url));
}

function forgetVideo(video: HTMLVideoElement, tracked: TrackedVideo): void {
  tracked.listeners.abort();
  tracked.button.remove();
  intersection?.unobserve(video);
  if (tracked.fallback) usedFallbacks.delete(tracked.fallback);
  videos.delete(video);
  scheduleReport();
}

function forgetDetached(): void {
  for (const [video, tracked] of videos) {
    if (!video.isConnected) forgetVideo(video, tracked);
  }
  for (const [element, tracked] of inline) {
    if (element.isConnected) continue;
    tracked.button.remove();
    inline.delete(element);
    scheduleReport();
  }
}

function scan(): void {
  forgetDetached();
  for (const video of document.querySelectorAll('video')) {
    if (videos.size >= MAX_VIDEOS) break;
    if (!videos.has(video)) trackVideo(video);
  }
  for (const audio of document.querySelectorAll('audio')) {
    if (inline.size >= MAX_INLINE) break;
    if (!inline.has(audio)) trackAudio(audio);
  }
  for (const link of document.querySelectorAll<HTMLAnchorElement>(LINK_SELECTOR)) {
    if (inline.size >= MAX_INLINE) break;
    if (!inline.has(link)) trackLink(link);
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
  if (active || retired) return;
  active = true;
  intersection = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      const tracked = videos.get(entry.target as HTMLVideoElement);
      if (tracked) tracked.visible = entry.isIntersecting;
    }
    schedulePosition();
  });
  observer = new MutationObserver((mutations) => {
    if (mutations.some((mutation) => !isOwnMutation(mutation))) scheduleScan();
  });
  observer.observe(document.body, { childList: true, subtree: true });
  window.addEventListener('scroll', schedulePosition, { passive: true, capture: true });
  window.addEventListener('resize', schedulePosition, { passive: true });
  document.addEventListener('fullscreenchange', schedulePosition);
  scan();
}

function deactivate(): void {
  if (!active) return;
  active = false;
  observer?.disconnect();
  intersection?.disconnect();
  observer = null;
  intersection = null;
  window.clearTimeout(scanTimer);
  window.removeEventListener('scroll', schedulePosition, { capture: true });
  window.removeEventListener('resize', schedulePosition);
  document.removeEventListener('fullscreenchange', schedulePosition);
  for (const [video, tracked] of videos) forgetVideo(video, tracked);
  for (const tracked of inline.values()) tracked.button.remove();
  inline.clear();
  usedFallbacks.clear();
  window.clearTimeout(reportTimer);
  report();
}

async function start(): Promise<void> {
  if (!document.body) return;
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
    if (!isWanted(settings)) {
      deactivate();
      return;
    }
    activate();
    for (const tracked of inline.values()) applyInlineVisibility(tracked.button);
    schedulePosition();
  };
  applySettings(await loadSettings());
  stopListening = onSettingsChanged(applySettings);
}

void start();
