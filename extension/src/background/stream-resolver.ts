import { estimateBytes, parsePlaylist, pickVariant, streamProblem, trackExtension, type HlsMedia, type HlsPlaylist, type StreamPlan, type StreamTrack } from '../core/hls';
import type { MediaInfo } from '../core/types';

const TIMEOUT_MS = 10_000;
const MAX_PLAYLIST_BYTES = 5 * 1024 * 1024;
const CACHE_TTL_MS = 10 * 60_000;
const cache = new Map<string, { plan: StreamPlan; expiresAt: number }>();

async function fetchPlaylist(url: string): Promise<{ playlist: HlsPlaylist; finalUrl: string }> {
  const response = await fetch(url, { credentials: 'include', cache: 'no-store', signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!response.ok) throw new Error(`Stream playlist returned ${response.status}`);
  if (Number(response.headers.get('content-length')) > MAX_PLAYLIST_BYTES) throw new Error('Stream playlist is too large');
  const text = await response.text();
  const playlist = parsePlaylist(text.slice(0, MAX_PLAYLIST_BYTES), response.url || url);
  if (!playlist) throw new Error('This is not an HLS stream');
  return { playlist, finalUrl: response.url || url };
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

export async function resolveStream(url: string): Promise<StreamPlan> {
  const cached = cache.get(url);
  if (cached && cached.expiresAt > Date.now()) return cached.plan;
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
  const plan: StreamPlan = {
    manifestUrl: finalUrl,
    tracks: audio ? [toTrack(video, 'video'), toTrack(audio, 'audio')] : [toTrack(video, 'video')],
    durationSeconds: video.durationSeconds,
    estimatedBytes: estimateBytes(bandwidth, video.durationSeconds),
    resolution,
  };
  cache.set(url, { plan, expiresAt: Date.now() + CACHE_TTL_MS });
  return plan;
}

export async function inspectStream(url: string): Promise<MediaInfo> {
  try {
    const plan = await resolveStream(url);
    const extension = plan.tracks[0]?.extension ?? 'ts';
    const separate = plan.tracks.length > 1 ? ' (video and audio save as two files)' : '';
    return {
      status: 'downloadable',
      url,
      extension,
      mime: 'application/vnd.apple.mpegurl',
      sizeBytes: plan.estimatedBytes,
      reason: `HLS stream${plan.resolution ? ` ${plan.resolution}` : ''}${separate}`,
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
