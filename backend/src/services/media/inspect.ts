import { dashRenditions, type DashRendition } from '../../../../extension/src/core/dash';
import { estimateBytes, heightOf, isAudioOnlyVariant, parsePlaylist, shortSide, streamProblem, trackExtension, type HlsMaster, type HlsMedia, type HlsVariant } from '../../../../extension/src/core/hls';
import { isRestrictedHost } from '../../../../extension/src/core/restricted-sites';
import { createLimiter } from '../../utils/limiter.js';
import { expectOk, fetchText, MediaFetchError, openSafe, readBody, safeMediaUrl, type SafeResponse } from './safe-http.js';
import { pageMediaSources, pageThumbnail, pageTitle } from './page-sources.js';
import { isTikTokUrl, tiktokInspection } from './tiktok.js';
import { MediaUnavailable, type MediaFormat, type MediaInspection } from './types.js';

const TEXT_LIMIT = 4 * 1024 * 1024;
const CANDIDATE_BUDGET_MS = 25_000;
const CANDIDATE_CONCURRENCY = 3;
const GENERIC_NAMES = /^(master|index|playlist|manifest|prog_index|video|stream|output|media|chunklist[\w-]*|main|default)$/i;
const AUDIO_ESTIMATE_BPS = 128_000;
const MEDIA_EXTENSIONS = new Set(['mp4', 'm4v', 'webm', 'mov', 'mkv', 'ts', 'mp3', 'm4a', 'aac', 'ogg', 'opus', 'wav', 'flac']);
const AUDIO_EXTENSIONS = new Set(['mp3', 'm4a', 'aac', 'ogg', 'opus', 'wav', 'flac']);
const HLS_TYPES = ['application/vnd.apple.mpegurl', 'application/x-mpegurl', 'audio/mpegurl', 'audio/x-mpegurl'];

function contentType(response: SafeResponse): string {
  const header = response.headers['content-type'];
  return (Array.isArray(header) ? header[0] : header || '').split(';')[0]?.trim().toLowerCase() || '';
}

function extensionOf(url: string): string {
  const match = /\.([a-z0-9]{2,4})$/i.exec(new URL(url).pathname);
  if (!match) {
    return '';
  }
  return (match[1] as string).toLowerCase();
}

function safeDecode(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

function fileName(url: string): string {
  const parsed = new URL(url);
  const last = parsed.pathname.split('/').filter(Boolean).at(-1);
  const name = last ? safeDecode(last).replace(/\.[a-z0-9]{2,5}$/i, '') : '';
  if (!name || GENERIC_NAMES.test(name)) {
    return `${parsed.hostname.replace(/^www\./, '')} video`;
  }
  return name;
}

function titleFor(title: string | null, url: string): string {
  if (!title || GENERIC_NAMES.test(title)) {
    return fileName(url);
  }
  return title;
}

function sizeFrom(response: SafeResponse): number | null {
  const range = /\/(\d+)$/.exec(String(response.headers['content-range'] || ''));
  const length = range ? Number(range[1]) : Number(response.headers['content-length']);
  return Number.isFinite(length) && length > 0 ? length : null;
}

function mbps(bandwidth: number): string {
  return `${(bandwidth / 1_000_000).toFixed(1)} Mbps`;
}

function qualityLabel(height: number): string {
  if (height >= 2160) {
    return `${height}p (4K)`;
  }
  return `${height}p`;
}

function heightFromUrl(url: string): number | null {
  const match = /(?:^|[^0-9])(2160|1440|1080|720|540|480|360|240|144)p?(?:[^0-9]|$)/.exec(new URL(url).pathname);
  return match ? Number(match[1]) : null;
}

function isMediaType(type: string, extension: string): boolean {
  if (type.startsWith('video/') || type.startsWith('audio/')) {
    return true;
  }
  return (type === 'application/octet-stream' || type === 'binary/octet-stream' || type === '') && MEDIA_EXTENSIONS.has(extension);
}

function isAudioFile(type: string, extension: string): boolean {
  if (type.startsWith('video/')) {
    return false;
  }
  return type.startsWith('audio/') || AUDIO_EXTENSIONS.has(extension);
}

function fileInspection(response: SafeResponse): MediaInspection {
  const extension = extensionOf(response.finalUrl) || contentType(response).split('/')[1] || 'mp4';
  const height = heightFromUrl(response.finalUrl);
  const audioOnly = isAudioFile(contentType(response), extension);
  response.body.destroy();
  const format: MediaFormat = {
    label: audioOnly ? 'Audio file' : height ? qualityLabel(height) : 'Original file',
    detail: `${extension.toUpperCase()} file`,
    height,
    sizeBytes: sizeFrom(response),
    exactSize: true,
    container: extension,
    audio: audioOnly ? 'only' : 'included',
    ref: { kind: 'file', url: response.finalUrl, extension },
  };
  return { title: fileName(response.finalUrl), source: 'file', durationSeconds: null, thumbnail: null, formats: [format] };
}

async function mediaPlaylist(url: string, referer: string | undefined): Promise<HlsMedia> {
  const { text, finalUrl } = await fetchText(url, TEXT_LIMIT, { referer });
  const playlist = parsePlaylist(text, finalUrl);
  if (!playlist || playlist.kind !== 'media') {
    throw new MediaUnavailable('unsupported', 'The stream playlist could not be read');
  }
  const problem = streamProblem(playlist);
  if (problem) {
    throw new MediaUnavailable('unsupported', problem);
  }
  return playlist;
}

function hlsVariantFormat(variant: HlsVariant, index: number, manifest: string, sample: HlsMedia, audio: HlsMedia | null): MediaFormat {
  const height = heightOf(variant.resolution);
  const separate = variant.audioUri !== null;
  const fragmented = sample.init !== null;
  const canMux = separate && fragmented && audio !== null && audio.init !== null;
  const container = fragmented ? 'mp4' : 'ts';
  const details = [variant.resolution, variant.bandwidth > 0 ? mbps(variant.bandwidth) : null, container.toUpperCase()].filter(Boolean);
  return {
    label: height > 0 ? qualityLabel(height) : `Quality ${index + 1}`,
    detail: separate && !canMux ? `${details.join(' · ')} · video only` : details.join(' · '),
    height: height > 0 ? height : null,
    sizeBytes: estimateBytes(variant.bandwidth, sample.durationSeconds),
    exactSize: false,
    container,
    audio: separate && !canMux ? 'none' : 'included',
    ref: { kind: 'hls', manifest, variant: index, audioOnly: false },
  };
}

function hlsAudioFormat(manifest: string, variantIndex: number, audio: HlsMedia): MediaFormat {
  const container = trackExtension(audio, 'audio');
  return {
    label: 'Audio only',
    detail: container.toUpperCase(),
    height: null,
    sizeBytes: estimateBytes(AUDIO_ESTIMATE_BPS, audio.durationSeconds),
    exactSize: false,
    container,
    audio: 'only',
    ref: { kind: 'hls', manifest, variant: variantIndex, audioOnly: true },
  };
}

async function masterInspection(master: HlsMaster, manifest: string, referer: string | undefined): Promise<MediaInspection> {
  const indexed = master.variants.map((variant, index) => ({ variant, index }));
  const videos = indexed.filter((item) => !isAudioOnlyVariant(item.variant)).sort((a, b) => b.variant.bandwidth - a.variant.bandwidth);
  const [top] = videos;
  if (!top) {
    throw new MediaUnavailable('unsupported', 'This stream has no video qualities');
  }
  const sample = await mediaPlaylist(top.variant.uri, referer);
  const withAudio = videos.find((item) => item.variant.audioUri !== null);
  const audio = withAudio ? await mediaPlaylist(withAudio.variant.audioUri as string, referer) : null;
  const formats = videos.map((item) => hlsVariantFormat(item.variant, item.index, manifest, sample, audio));
  if (withAudio && audio) {
    formats.push(hlsAudioFormat(manifest, withAudio.index, audio));
  }
  return { title: fileName(manifest), source: 'hls', durationSeconds: sample.durationSeconds, thumbnail: null, formats };
}

async function hlsInspection(text: string, manifest: string, referer: string | undefined): Promise<MediaInspection> {
  const playlist = parsePlaylist(text, manifest);
  if (!playlist) {
    throw new MediaUnavailable('unsupported', 'This is not a valid HLS playlist');
  }
  if (playlist.kind === 'master') {
    return masterInspection(playlist, manifest, referer);
  }
  const problem = streamProblem(playlist);
  if (problem) {
    throw new MediaUnavailable('unsupported', problem);
  }
  const container = trackExtension(playlist, 'video');
  const format: MediaFormat = {
    label: 'Original quality',
    detail: container.toUpperCase(),
    height: null,
    sizeBytes: null,
    exactSize: false,
    container,
    audio: 'included',
    ref: { kind: 'hls', manifest, variant: null, audioOnly: false },
  };
  return { title: fileName(manifest), source: 'hls', durationSeconds: playlist.durationSeconds, thumbnail: null, formats: [format] };
}

function dashContainer(rendition: DashRendition): string {
  if (rendition.mime.includes('webm')) {
    return 'webm';
  }
  return rendition.kind === 'audio' ? 'm4a' : 'mp4';
}

function dashVideoFormat(video: DashRendition, audio: DashRendition | undefined, manifest: string, duration: number): MediaFormat {
  const height = shortSide(video.width, video.height);
  const container = dashContainer(video);
  const canMux = !video.hasAudio && audio !== undefined && video.joinable && audio.joinable && container === 'mp4' && dashContainer(audio) === 'm4a';
  const included = video.hasAudio || canMux;
  const bandwidth = video.bandwidth + (canMux && audio ? audio.bandwidth : 0);
  const resolution = video.width > 0 && video.height > 0 ? `${video.width}x${video.height}` : null;
  const details = [resolution, bandwidth > 0 ? mbps(bandwidth) : null, container.toUpperCase()].filter(Boolean);
  return {
    label: height > 0 ? qualityLabel(height) : `Quality ${video.index + 1}`,
    detail: included ? details.join(' · ') : `${details.join(' · ')} · video only`,
    height: height > 0 ? height : null,
    sizeBytes: estimateBytes(bandwidth, duration),
    exactSize: false,
    container,
    audio: included ? 'included' : 'none',
    ref: { kind: 'dash', manifest, rendition: video.index },
  };
}

function dashInspection(text: string, manifest: string): MediaInspection {
  let parsed: ReturnType<typeof dashRenditions>;
  try {
    parsed = dashRenditions(text, manifest);
  } catch (error) {
    throw new MediaUnavailable('unsupported', error instanceof Error ? error.message : 'This DASH stream could not be read');
  }
  const { durationSeconds, renditions } = parsed;
  const videos = renditions.filter((item) => item.kind === 'video').sort((a, b) => b.bandwidth - a.bandwidth);
  const audio = renditions.filter((item) => item.kind === 'audio').sort((a, b) => b.bandwidth - a.bandwidth)[0];
  const formats = videos.map((video) => dashVideoFormat(video, audio, manifest, durationSeconds));
  if (audio) {
    formats.push({
      label: 'Audio only',
      detail: dashContainer(audio).toUpperCase(),
      height: null,
      sizeBytes: estimateBytes(audio.bandwidth, durationSeconds),
      exactSize: false,
      container: dashContainer(audio),
      audio: 'only',
      ref: { kind: 'dash', manifest, rendition: audio.index },
    });
  }
  if (formats.length === 0) {
    throw new MediaUnavailable('unsupported', 'This stream has no video qualities');
  }
  return { title: fileName(manifest), source: 'dash', durationSeconds: durationSeconds > 0 ? durationSeconds : null, thumbnail: null, formats };
}

function rank(format: MediaFormat): number {
  if (format.audio === 'only') {
    return -1;
  }
  return format.height === null ? 0 : format.height;
}

function dedupe(formats: MediaFormat[]): MediaFormat[] {
  const seen = new Set<string>();
  return formats
    .sort((a, b) => rank(b) - rank(a))
    .filter((format) => {
      const key = `${format.label}|${format.container}|${format.audio}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
}

function withinBudget<T>(task: Promise<T>, deadline: number): Promise<T | null> {
  const remaining = Math.max(0, deadline - Date.now());
  let timer: NodeJS.Timeout | undefined;
  const expired = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), remaining);
  });
  return Promise.race([task, expired]).finally(() => clearTimeout(timer));
}

async function tryCandidate(source: string, pageUrl: string): Promise<MediaInspection | null> {
  try {
    return await inspectAt(source, 1, pageUrl);
  } catch {
    return null;
  }
}

async function pageInspection(html: string, pageUrl: string): Promise<MediaInspection> {
  const sources = pageMediaSources(html, pageUrl).filter((source) => !isRestrictedHost(new URL(source).hostname));
  const deadline = Date.now() + CANDIDATE_BUDGET_MS;
  const limit = createLimiter(CANDIDATE_CONCURRENCY);
  const results = await Promise.all(sources.map((source) => limit(() => withinBudget(tryCandidate(source, pageUrl), deadline))));
  const found = results.filter((item): item is MediaInspection => item !== null);
  const formats = dedupe(found.flatMap((item) => item.formats));
  if (formats.length === 0) {
    throw new MediaUnavailable('not_found', 'No downloadable video was found on this page');
  }
  const durations = found.map((item) => item.durationSeconds).filter((value): value is number => value !== null);
  return {
    title: titleFor(pageTitle(html), pageUrl),
    source: 'page',
    durationSeconds: durations[0] === undefined ? null : durations[0],
    thumbnail: pageThumbnail(html, pageUrl),
    formats,
  };
}

function looksLikeHls(type: string, extension: string, text: string): boolean {
  return HLS_TYPES.includes(type) || extension === 'm3u8' || text.trimStart().startsWith('#EXTM3U');
}

function looksLikeDash(type: string, extension: string, text: string): boolean {
  return type === 'application/dash+xml' || extension === 'mpd' || /<MPD[\s>]/.test(text.slice(0, 4096));
}

function withReferer(inspection: MediaInspection, referer: string | undefined): MediaInspection {
  if (!referer) {
    return inspection;
  }
  return { ...inspection, formats: inspection.formats.map((format) => ({ ...format, ref: { ...format.ref, referer } })) };
}

async function inspectAt(url: string, depth: number, referer?: string): Promise<MediaInspection> {
  return withReferer(await inspectResource(url, depth, referer), referer);
}

async function inspectResource(url: string, depth: number, referer: string | undefined): Promise<MediaInspection> {
  if (isRestrictedHost(new URL(url).hostname)) {
    throw new MediaUnavailable('restricted', 'This website does not allow downloads, so it is not supported');
  }
  const response = await openSafe(url, { referer });
  expectOk(response);
  if (isRestrictedHost(new URL(response.finalUrl).hostname)) {
    response.body.destroy();
    throw new MediaUnavailable('restricted', 'This website does not allow downloads, so it is not supported');
  }
  const type = contentType(response);
  const extension = extensionOf(response.finalUrl);
  if (isMediaType(type, extension) && !HLS_TYPES.includes(type)) {
    return fileInspection(response);
  }
  const text = (await readBody(response, TEXT_LIMIT)).toString('utf8');
  if (looksLikeHls(type, extension, text)) {
    return hlsInspection(text, response.finalUrl, referer);
  }
  if (looksLikeDash(type, extension, text)) {
    return dashInspection(text, response.finalUrl);
  }
  if (depth === 0 && /html|xml|text/.test(type)) {
    return pageInspection(text, response.finalUrl);
  }
  throw new MediaUnavailable('not_found', 'No downloadable video was found at this link');
}

export async function inspectMediaUrl(url: string): Promise<MediaInspection> {
  const safe = safeMediaUrl(url);
  if (!safe) {
    throw new MediaFetchError('invalid_url', 'Only public http and https links are supported');
  }
  if (isTikTokUrl(safe)) {
    return tiktokInspection(safe.toString());
  }
  const inspection = await inspectAt(safe.toString(), 0);
  return { ...inspection, formats: dedupe(inspection.formats) };
}
