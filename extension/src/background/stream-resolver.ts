import { errorMessage } from '../core/errors';
import { planFromDash, REST_OF_FILE } from '../core/dash';
import { parseSidx } from '../core/fmp4';
import { audioOnlyPlan, canCombine, estimateBytes, hlsQualities, parsePlaylist, pickMuxedVariant, pickSubtitles, pickVariant, streamProblem, trackExtension, type HlsMaster, type HlsMedia, type HlsPlaylist, type HlsVariant, type StreamPlan, type StreamSegment, type StreamTrack } from '../core/hls';
import { extensionFromPath, safeHttpUrl } from '../core/media';
import { subtitleLanguage, type SubtitleTrack } from '../core/subtitles';
import type { MediaInfo } from '../core/types';

const TIMEOUT_MS = 10_000;
const MAX_PLAYLIST_BYTES = 5 * 1024 * 1024;
const CACHE_TTL_MS = 10 * 60_000;
const CHUNK_BYTES = 8 * 1024 * 1024;
const cache = new Map<string, { plan: StreamPlan; expiresAt: number }>();

async function fetchText(url: string): Promise<{ text: string; finalUrl: string }> {
  const response = await fetch(url, { credentials: 'include', cache: 'no-store', signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!response.ok) {
    throw new Error(`Stream playlist returned ${response.status}`);
  }
  if (Number(response.headers.get('content-length')) > MAX_PLAYLIST_BYTES) {
    throw new Error('Stream playlist is too large');
  }
  const text = await response.text();
  return { text: text.slice(0, MAX_PLAYLIST_BYTES), finalUrl: response.url || url };
}

async function fetchPlaylist(url: string): Promise<{ playlist: HlsPlaylist; finalUrl: string }> {
  const { text, finalUrl } = await fetchText(url);
  const playlist = parsePlaylist(text, finalUrl);
  if (!playlist) {
    throw new Error('This is not an HLS stream');
  }
  return { playlist, finalUrl };
}

async function fetchMedia(url: string): Promise<HlsMedia> {
  const { playlist } = await fetchPlaylist(url);
  if (playlist.kind !== 'media') {
    throw new Error('Unexpected nested stream playlist');
  }
  const problem = streamProblem(playlist);
  if (problem) {
    throw new Error(problem);
  }
  return playlist;
}

function toTrack(media: HlsMedia, kind: StreamTrack['kind']): StreamTrack {
  return { kind, extension: trackExtension(media, kind), init: media.init, segments: media.segments };
}

async function fileSize(url: string): Promise<number | null> {
  const init: RequestInit = { credentials: 'include', cache: 'no-store', signal: AbortSignal.timeout(TIMEOUT_MS) };
  const head = await fetch(url, { ...init, method: 'HEAD' });
  const length = Number(head.headers.get('content-length'));
  if (head.ok && length > 0) {
    return length;
  }
  const probe = await fetch(url, { ...init, headers: { range: 'bytes=0-0' } });
  await probe.body?.cancel().catch(() => undefined);
  const total = Number(/\/(\d+)$/.exec(probe.headers.get('content-range') ?? '')?.[1]);
  return total > 0 ? total : null;
}

async function fetchRange(url: string, range: { start: number; end: number }): Promise<Uint8Array> {
  const response = await fetch(url, {
    credentials: 'include',
    cache: 'no-store',
    headers: { range: `bytes=${range.start}-${range.end}` },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (response.status !== 206) {
    throw new Error(`Stream index returned ${response.status}`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

async function indexedFragments(segment: StreamSegment): Promise<StreamSegment[] | null> {
  if (!segment.index) {
    return null;
  }
  try {
    const ranges = parseSidx(await fetchRange(segment.url, segment.index), segment.index.start);
    return ranges && ranges.length > 0 ? ranges.map((range) => ({ url: segment.url, range })) : null;
  } catch {
    return null;
  }
}

async function chunkedFile(segment: StreamSegment & { range: { start: number; end: number } }): Promise<StreamSegment[]> {
  const size = await fileSize(segment.url);
  if (!size) {
    throw new Error('Could not read the size of this video file');
  }
  const out: StreamSegment[] = [];
  for (let start = segment.range.start; start < size; start += CHUNK_BYTES) {
    out.push({ url: segment.url, range: { start, end: Math.min(start + CHUNK_BYTES, size) - 1 } });
  }
  return out;
}

async function splitWholeFiles(segments: StreamSegment[]): Promise<{ segments: StreamSegment[]; aligned: boolean }> {
  const out: StreamSegment[] = [];
  let aligned = true;
  for (const segment of segments) {
    if (segment.range?.end !== REST_OF_FILE) {
      out.push(segment);
      continue;
    }
    const fragments = await indexedFragments(segment);
    if (fragments) {
      out.push(...fragments);
      continue;
    }
    aligned = false;
    out.push(...(await chunkedFile(segment as StreamSegment & { range: { start: number; end: number } })));
  }
  return { segments: out, aligned };
}

async function resolveDash(url: string, maxHeight: number): Promise<StreamPlan> {
  const { text, finalUrl } = await fetchText(url);
  const plan = planFromDash(text, finalUrl, maxHeight);
  const split = await Promise.all(plan.tracks.map((track) => splitWholeFiles(track.segments)));
  const tracks = plan.tracks.map((track, index) => ({ ...track, segments: split[index]?.segments ?? track.segments }));
  return { ...plan, tracks, combine: plan.combine && split.every((item) => item.aligned) };
}

function isDash(url: string): boolean {
  const parsed = safeHttpUrl(url);
  return parsed !== null && extensionFromPath(parsed) === 'mpd';
}

export async function resolveStream(url: string, maxHeight = Number.POSITIVE_INFINITY): Promise<StreamPlan> {
  const key = `${maxHeight}|${url}`;
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.plan;
  }
  const plan = isDash(url) ? await resolveDash(url, maxHeight) : await resolveHls(url, maxHeight);
  cache.set(key, { plan, expiresAt: Date.now() + CACHE_TTL_MS });
  return plan;
}

function planFrom(manifestUrl: string, video: HlsMedia, audio: HlsMedia | null, variant: HlsVariant | null): StreamPlan {
  const tracks = audio ? [toTrack(video, 'video'), toTrack(audio, 'audio')] : [toTrack(video, 'video')];
  const bandwidth = variant ? variant.bandwidth : 0;
  return {
    manifestUrl,
    tracks,
    combine: canCombine(tracks),
    durationSeconds: video.durationSeconds,
    estimatedBytes: estimateBytes(bandwidth, video.durationSeconds),
    resolution: variant ? variant.resolution : null,
  };
}

async function planVariant(manifestUrl: string, variant: HlsVariant): Promise<StreamPlan> {
  const [video, audio] = await Promise.all([fetchMedia(variant.uri), variant.audioUri ? fetchMedia(variant.audioUri) : Promise.resolve(null)]);
  return planFrom(manifestUrl, video, audio, variant);
}

async function hlsSubtitles(master: HlsMaster, variant: HlsVariant): Promise<SubtitleTrack | null> {
  const option = pickSubtitles(master, variant);
  if (!option) {
    return null;
  }
  try {
    const { playlist } = await fetchPlaylist(option.uri);
    if (playlist.kind !== 'media' || playlist.segments.length === 0) {
      return null;
    }
    return { language: subtitleLanguage(option.language), segments: playlist.segments.map((segment) => segment.url) };
  } catch {
    return null;
  }
}

async function chooseVariantPlan(manifestUrl: string, master: HlsMaster, maxHeight: number): Promise<{ plan: StreamPlan; variant: HlsVariant }> {
  const best = pickVariant(master, maxHeight);
  if (!best) {
    throw new Error('This stream has no playable quality');
  }
  const plan = await planVariant(manifestUrl, best);
  const muxed = pickMuxedVariant(master, maxHeight);
  if (plan.tracks.length < 2 || plan.combine || !muxed) {
    return { plan, variant: best };
  }
  return planVariant(manifestUrl, muxed)
    .then((muxedPlan) => ({ plan: muxedPlan, variant: muxed }))
    .catch(() => ({ plan, variant: best }));
}

async function planMaster(manifestUrl: string, master: HlsMaster, maxHeight: number): Promise<StreamPlan> {
  const { plan, variant } = await chooseVariantPlan(manifestUrl, master, maxHeight);
  return { ...plan, subtitles: await hlsSubtitles(master, variant), qualities: hlsQualities(master, plan.durationSeconds) };
}

async function resolveHls(url: string, maxHeight: number): Promise<StreamPlan> {
  const { playlist, finalUrl } = await fetchPlaylist(url);
  if (playlist.kind === 'master') {
    return planMaster(finalUrl, playlist, maxHeight);
  }
  const problem = streamProblem(playlist);
  if (problem) {
    throw new Error(problem);
  }
  return planFrom(finalUrl, playlist, null, null);
}

export async function inspectStream(url: string, maxHeight = Number.POSITIVE_INFINITY): Promise<MediaInfo> {
  try {
    const plan = await resolveStream(url, maxHeight);
    const extension = plan.tracks[0]?.extension ?? 'ts';
    const separate = plan.tracks.length > 1 && !plan.combine ? ' (video and audio save as two files)' : '';
    return {
      status: 'downloadable',
      url,
      extension,
      mime: isDash(url) ? 'application/dash+xml' : 'application/vnd.apple.mpegurl',
      sizeBytes: plan.estimatedBytes,
      separateAudio: plan.tracks.length > 1,
      qualities: plan.qualities,
      audioOnly: audioOnlyPlan(plan) !== null,
      reason: `${isDash(url) ? 'DASH' : 'HLS'} stream${plan.resolution ? ` ${plan.resolution}` : ''}${separate}`,
    };
  } catch (error) {
    return {
      status: 'unavailable',
      url,
      extension: null,
      mime: null,
      sizeBytes: null,
      reason: errorMessage(error, 'Could not read this stream'),
    };
  }
}
