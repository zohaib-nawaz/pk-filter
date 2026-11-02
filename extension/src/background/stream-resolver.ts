import { planFromDash, REST_OF_FILE } from '../core/dash';
import { parseSidx } from '../core/fmp4';
import { canCombine, estimateBytes, parsePlaylist, pickVariant, streamProblem, trackExtension, type HlsMedia, type HlsPlaylist, type StreamPlan, type StreamSegment, type StreamTrack } from '../core/hls';
import { extensionFromPath, safeHttpUrl } from '../core/media';
import type { MediaInfo } from '../core/types';

const TIMEOUT_MS = 10_000;
const MAX_PLAYLIST_BYTES = 5 * 1024 * 1024;
const CACHE_TTL_MS = 10 * 60_000;
const CHUNK_BYTES = 8 * 1024 * 1024;
const cache = new Map<string, { plan: StreamPlan; expiresAt: number }>();

async function fetchText(url: string): Promise<{ text: string; finalUrl: string }> {
  const response = await fetch(url, { credentials: 'include', cache: 'no-store', signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!response.ok) throw new Error(`Stream playlist returned ${response.status}`);
  if (Number(response.headers.get('content-length')) > MAX_PLAYLIST_BYTES) throw new Error('Stream playlist is too large');
  const text = await response.text();
  return { text: text.slice(0, MAX_PLAYLIST_BYTES), finalUrl: response.url || url };
}

async function fetchPlaylist(url: string): Promise<{ playlist: HlsPlaylist; finalUrl: string }> {
  const { text, finalUrl } = await fetchText(url);
  const playlist = parsePlaylist(text, finalUrl);
  if (!playlist) throw new Error('This is not an HLS stream');
  return { playlist, finalUrl };
}

async function fetchMedia(url: string): Promise<HlsMedia> {
  const { playlist } = await fetchPlaylist(url);
  if (playlist.kind !== 'media') throw new Error('Unexpected nested stream playlist');
  const problem = streamProblem(playlist);
  if (problem) throw new Error(problem);
  return playlist;
}

function toTrack(media: HlsMedia, kind: StreamTrack['kind']): StreamTrack {
  return { kind, extension: trackExtension(media, kind), init: media.init, segments: media.segments };
}

async function fileSize(url: string): Promise<number | null> {
  const init: RequestInit = { credentials: 'include', cache: 'no-store', signal: AbortSignal.timeout(TIMEOUT_MS) };
  const head = await fetch(url, { ...init, method: 'HEAD' });
  const length = Number(head.headers.get('content-length'));
  if (head.ok && length > 0) return length;
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
  if (response.status !== 206) throw new Error(`Stream index returned ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

async function indexedFragments(segment: StreamSegment): Promise<StreamSegment[] | null> {
  if (!segment.index) return null;
  try {
    const ranges = parseSidx(await fetchRange(segment.url, segment.index), segment.index.start);
    return ranges && ranges.length > 0 ? ranges.map((range) => ({ url: segment.url, range })) : null;
  } catch {
    return null;
  }
}

async function chunkedFile(segment: StreamSegment & { range: { start: number; end: number } }): Promise<StreamSegment[]> {
  const size = await fileSize(segment.url);
  if (!size) throw new Error('Could not read the size of this video file');
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

async function resolveDash(url: string): Promise<StreamPlan> {
  const { text, finalUrl } = await fetchText(url);
  const plan = planFromDash(text, finalUrl);
  const split = await Promise.all(plan.tracks.map((track) => splitWholeFiles(track.segments)));
  const tracks = plan.tracks.map((track, index) => ({ ...track, segments: split[index]?.segments ?? track.segments }));
  return { ...plan, tracks, combine: plan.combine && split.every((item) => item.aligned) };
}

function isDash(url: string): boolean {
  const parsed = safeHttpUrl(url);
  return parsed !== null && extensionFromPath(parsed) === 'mpd';
}

export async function resolveStream(url: string): Promise<StreamPlan> {
  const cached = cache.get(url);
  if (cached && cached.expiresAt > Date.now()) return cached.plan;
  const plan = isDash(url) ? await resolveDash(url) : await resolveHls(url);
  cache.set(url, { plan, expiresAt: Date.now() + CACHE_TTL_MS });
  return plan;
}

async function resolveHls(url: string): Promise<StreamPlan> {
  const { playlist, finalUrl } = await fetchPlaylist(url);
  let video: HlsMedia;
  let audio: HlsMedia | null = null;
  let bandwidth = 0;
  let resolution: string | null = null;
  if (playlist.kind === 'master') {
    const variant = pickVariant(playlist);
    if (!variant) throw new Error('This stream has no playable quality');
    [video, audio] = await Promise.all([fetchMedia(variant.uri), variant.audioUri ? fetchMedia(variant.audioUri) : Promise.resolve(null)]);
    bandwidth = variant.bandwidth;
    resolution = variant.resolution;
  } else {
    const problem = streamProblem(playlist);
    if (problem) throw new Error(problem);
    video = playlist;
  }
  const tracks = audio ? [toTrack(video, 'video'), toTrack(audio, 'audio')] : [toTrack(video, 'video')];
  const plan: StreamPlan = {
    manifestUrl: finalUrl,
    tracks,
    combine: canCombine(tracks),
    durationSeconds: video.durationSeconds,
    estimatedBytes: estimateBytes(bandwidth, video.durationSeconds),
    resolution,
  };
  return plan;
}

export async function inspectStream(url: string): Promise<MediaInfo> {
  try {
    const plan = await resolveStream(url);
    const extension = plan.tracks[0]?.extension ?? 'ts';
    const separate = plan.tracks.length > 1 && !plan.combine ? ' (video and audio save as two files)' : '';
    return {
      status: 'downloadable',
      url,
      extension,
      mime: isDash(url) ? 'application/dash+xml' : 'application/vnd.apple.mpegurl',
      sizeBytes: plan.estimatedBytes,
      reason: `${isDash(url) ? 'DASH' : 'HLS'} stream${plan.resolution ? ` ${plan.resolution}` : ''}${separate}`,
    };
  } catch (error) {
    return {
      status: 'unavailable',
      url,
      extension: null,
      mime: null,
      sizeBytes: null,
      reason: error instanceof Error ? error.message : 'Could not read this stream',
    };
  }
}
