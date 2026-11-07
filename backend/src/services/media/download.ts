import { REST_OF_FILE, planFromDash } from '../../../../extension/src/core/dash';
import { buildFilename } from '../../../../extension/src/core/filename';
import { interleave, mergeInitSegments, parseSidx, retagFragment } from '../../../../extension/src/core/fmp4';
import { canCombine, parsePlaylist, streamProblem, trackExtension, type HlsMedia, type StreamSegment, type StreamTrack } from '../../../../extension/src/core/hls';
import { bodyChunks, expectOk, fetchBytes, fetchText, headerValue, MediaFetchError, openSafe } from './safe-http.js';
import { MediaUnavailable, type FormatRef } from './types.js';

export interface DownloadLimits {
  maxBytes: number;
}

export interface DownloadStream {
  filename: string;
  contentType: string;
  sizeBytes: number | null;
  status: 200 | 206;
  contentRange: string | null;
  acceptRanges: boolean;
  validators: Record<string, string>;
  chunks: AsyncIterable<Uint8Array>;
}

export interface ByteRange {
  start: number;
  end: number | null;
}

interface FetchContext {
  signal: AbortSignal;
  referer: string | undefined;
}

const TEXT_LIMIT = 4 * 1024 * 1024;
const SEGMENT_LIMIT = 256 * 1024 * 1024;
const INDEX_LIMIT = 4 * 1024 * 1024;
const PREFETCH = 4;
const ATTEMPTS = 4;
const RETRY_DELAYS_MS = [500, 1500, 4000];
const RETRY_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);
const CONTENT_TYPES: Record<string, string> = {
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  ts: 'video/mp2t',
  webm: 'video/webm',
  mov: 'video/quicktime',
  mkv: 'video/x-matroska',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  mp3: 'audio/mpeg',
  ogg: 'audio/ogg',
  opus: 'audio/opus',
  wav: 'audio/wav',
  flac: 'audio/flac',
};

function contentTypeFor(extension: string): string {
  const known = CONTENT_TYPES[extension];
  if (!known) {
    return 'application/octet-stream';
  }
  return known;
}

function rangeOf(segment: StreamSegment): { start: number; end: number | null } | undefined {
  if (!segment.range) {
    return undefined;
  }
  return { start: segment.range.start, end: segment.range.end === REST_OF_FILE ? null : segment.range.end };
}

function isRetryable(error: unknown): boolean {
  if (!(error instanceof MediaFetchError)) {
    return false;
  }
  if (error.failure === 'timeout' || error.failure === 'network') {
    return true;
  }
  return error.status !== null && RETRY_STATUSES.has(error.status);
}

function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

async function fetchSegment(segment: StreamSegment, context: FetchContext): Promise<Uint8Array> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < ATTEMPTS && !context.signal.aborted; attempt += 1) {
    try {
      return await fetchBytes(segment.url, SEGMENT_LIMIT, { range: rangeOf(segment), signal: context.signal, referer: context.referer });
    } catch (error) {
      lastError = error;
      if (!isRetryable(error) || attempt === ATTEMPTS - 1) {
        break;
      }
      await pause(RETRY_DELAYS_MS[attempt] as number, context.signal);
    }
  }
  throw lastError instanceof Error ? lastError : new MediaFetchError('network', 'A video segment could not be downloaded');
}

async function* prefetched<T>(items: T[], load: (item: T) => Promise<Uint8Array>): AsyncGenerator<Uint8Array> {
  const pending: Array<Promise<Uint8Array>> = [];
  let next = 0;
  const launch = () => {
    while (pending.length < PREFETCH && next < items.length) {
      const task = load(items[next] as T);
      task.catch(() => undefined);
      pending.push(task);
      next += 1;
    }
  };
  launch();
  while (pending.length > 0) {
    const chunk = await (pending.shift() as Promise<Uint8Array>);
    launch();
    yield chunk;
  }
}

async function* streamWholeFile(segment: StreamSegment, context: FetchContext): AsyncGenerator<Uint8Array> {
  const response = await openSafe(segment.url, { range: rangeOf(segment), signal: context.signal, referer: context.referer, timeoutMs: 60_000 });
  expectOk(response);
  yield* bodyChunks(response);
}

async function* trackBytes(track: StreamTrack, context: FetchContext): AsyncGenerator<Uint8Array> {
  if (track.init) {
    yield await fetchSegment(track.init, context);
  }
  const [only] = track.segments;
  if (track.segments.length === 1 && only) {
    yield* streamWholeFile(only, context);
    return;
  }
  yield* prefetched(track.segments, (segment) => fetchSegment(segment, context));
}

async function* muxedBytes(video: StreamTrack, audio: StreamTrack, context: FetchContext): AsyncGenerator<Uint8Array> {
  const [videoInit, audioInit] = await Promise.all([fetchSegment(video.init as StreamSegment, context), fetchSegment(audio.init as StreamSegment, context)]);
  const merged = mergeInitSegments(videoInit, audioInit);
  yield merged.init;
  const items = interleave(
    video.segments.map((segment) => ({ segment, audio: false })),
    audio.segments.map((segment) => ({ segment, audio: true })),
  );
  yield* prefetched(items, async (item) => {
    const bytes = await fetchSegment(item.segment, context);
    return item.audio ? retagFragment(bytes, merged.audioTrackId) : bytes;
  });
}

export async function* limited(source: AsyncIterable<Uint8Array>, maxBytes: number): AsyncGenerator<Uint8Array> {
  let total = 0;
  for await (const chunk of source) {
    total += chunk.byteLength;
    if (total > maxBytes) {
      throw new MediaFetchError('too_large', 'This video is larger than the download limit');
    }
    yield chunk;
  }
}

async function hlsMedia(url: string, context: FetchContext): Promise<HlsMedia> {
  const { text, finalUrl } = await fetchText(url, TEXT_LIMIT, context);
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

function toTrack(media: HlsMedia, kind: StreamTrack['kind']): StreamTrack {
  return { kind, extension: trackExtension(media, kind), init: media.init, segments: media.segments };
}

async function hlsTracks(ref: Extract<FormatRef, { kind: 'hls' }>, context: FetchContext): Promise<StreamTrack[]> {
  const { text, finalUrl } = await fetchText(ref.manifest, TEXT_LIMIT, context);
  const playlist = parsePlaylist(text, finalUrl);
  if (!playlist) {
    throw new MediaUnavailable('unsupported', 'The stream playlist could not be read');
  }
  if (playlist.kind === 'media') {
    return [toTrack(await hlsMedia(finalUrl, context), 'video')];
  }
  const variant = ref.variant === null ? undefined : playlist.variants[ref.variant];
  if (!variant) {
    throw new MediaUnavailable('not_found', 'This quality is no longer available');
  }
  if (ref.audioOnly) {
    if (!variant.audioUri) {
      throw new MediaUnavailable('not_found', 'This stream has no separate audio');
    }
    return [toTrack(await hlsMedia(variant.audioUri, context), 'audio')];
  }
  const video = toTrack(await hlsMedia(variant.uri, context), 'video');
  if (!variant.audioUri || video.init === null) {
    return [video];
  }
  return [video, toTrack(await hlsMedia(variant.audioUri, context), 'audio')];
}

async function indexedSegments(track: StreamTrack, context: FetchContext): Promise<StreamTrack | null> {
  const [only] = track.segments;
  if (!only || !only.range || only.range.end !== REST_OF_FILE) {
    return track;
  }
  if (!only.index) {
    return null;
  }
  let ranges: Array<{ start: number; end: number }> | null;
  try {
    ranges = parseSidx(await fetchBytes(only.url, INDEX_LIMIT, { range: only.index, ...context }), only.index.start);
  } catch (error) {
    if (error instanceof RangeError || error instanceof MediaFetchError) {
      return null;
    }
    throw error;
  }
  if (!ranges || ranges.length === 0) {
    return null;
  }
  return { ...track, segments: ranges.map((range) => ({ url: only.url, range })) };
}

async function dashTracks(ref: Extract<FormatRef, { kind: 'dash' }>, context: FetchContext): Promise<StreamTrack[]> {
  const { text, finalUrl } = await fetchText(ref.manifest, TEXT_LIMIT, context);
  let tracks: StreamTrack[];
  try {
    tracks = planFromDash(text, finalUrl, Number.POSITIVE_INFINITY, ref.rendition).tracks;
  } catch (error) {
    throw new MediaUnavailable('unsupported', error instanceof Error ? error.message : 'This DASH stream could not be read');
  }
  const [video, audio] = tracks;
  if (!video || !audio || !canCombine(tracks)) {
    return tracks;
  }
  const [indexedVideo, indexedAudio] = await Promise.all([indexedSegments(video, context), indexedSegments(audio, context)]);
  if (!indexedVideo || !indexedAudio) {
    throw new MediaUnavailable('unsupported', 'The sound of this quality cannot be joined to the video. Pick another quality or Audio only.');
  }
  return [indexedVideo, indexedAudio];
}

function streamFor(tracks: StreamTrack[], title: string, context: FetchContext, limits: DownloadLimits): DownloadStream {
  const [video, audio] = tracks;
  if (!video) {
    throw new MediaUnavailable('unsupported', 'This stream has no segments');
  }
  const combined = audio !== undefined && canCombine(tracks);
  const extension = combined ? 'mp4' : video.extension;
  const source = combined && audio ? muxedBytes(video, audio, context) : trackBytes(video, context);
  return {
    filename: buildFilename(title, extension),
    contentType: contentTypeFor(extension),
    sizeBytes: null,
    status: 200,
    contentRange: null,
    acceptRanges: false,
    validators: {},
    chunks: limited(source, limits.maxBytes),
  };
}

function validatorsOf(headers: Record<string, string | string[] | undefined>): Record<string, string> {
  const found: Record<string, string> = {};
  for (const name of ['etag', 'last-modified']) {
    const value = headerValue(headers[name]);
    if (value) {
      found[name] = value;
    }
  }
  return found;
}

function positiveNumber(value: string): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

async function fileStream(ref: Extract<FormatRef, { kind: 'file' }>, title: string, context: FetchContext, limits: DownloadLimits, range: ByteRange | null): Promise<DownloadStream> {
  const response = await openSafe(ref.url, { signal: context.signal, referer: context.referer, timeoutMs: 60_000, range: range ? range : undefined });
  expectOk(response);
  const partial = range !== null && response.status === 206;
  const sizeBytes = positiveNumber(headerValue(response.headers['content-length']));
  const total = partial ? positiveNumber(/\/(\d+)$/.exec(headerValue(response.headers['content-range']))?.[1] || '') : sizeBytes;
  if (total !== null && total > limits.maxBytes) {
    response.body.destroy();
    throw new MediaFetchError('too_large', 'This video is larger than the download limit');
  }
  return {
    filename: buildFilename(title, ref.extension),
    contentType: contentTypeFor(ref.extension),
    sizeBytes,
    status: partial ? 206 : 200,
    contentRange: partial ? headerValue(response.headers['content-range']) || null : null,
    acceptRanges: partial || headerValue(response.headers['accept-ranges']).toLowerCase() === 'bytes',
    validators: validatorsOf(response.headers),
    chunks: limited(bodyChunks(response), limits.maxBytes),
  };
}

export async function openDownload(ref: FormatRef, title: string, signal: AbortSignal, limits: DownloadLimits, range: ByteRange | null = null): Promise<DownloadStream> {
  const context: FetchContext = { signal, referer: ref.referer };
  if (ref.kind === 'file') {
    return fileStream(ref, title, context, limits, range);
  }
  const tracks = ref.kind === 'hls' ? await hlsTracks(ref, context) : await dashTracks(ref, context);
  return streamFor(tracks, title, context, limits);
}
