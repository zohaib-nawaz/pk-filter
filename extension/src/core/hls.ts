import { extensionFromPath, safeHttpUrl } from './media';

export interface HlsVariant {
  uri: string;
  bandwidth: number;
  resolution: string | null;
  audioUri: string | null;
  codecs: string;
}

export interface HlsMaster {
  kind: 'master';
  variants: HlsVariant[];
}

export interface StreamSegment {
  url: string;
  range: { start: number; end: number } | null;
  index?: { start: number; end: number };
}

export interface HlsMedia {
  kind: 'media';
  segments: StreamSegment[];
  init: StreamSegment | null;
  encrypted: boolean;
  live: boolean;
  durationSeconds: number;
  mixedInit: boolean;
}

export type HlsPlaylist = HlsMaster | HlsMedia;

export type StreamTrackKind = 'video' | 'audio';

export interface StreamTrack {
  kind: StreamTrackKind;
  extension: string;
  init: StreamSegment | null;
  segments: StreamSegment[];
}

export interface StreamPlan {
  manifestUrl: string;
  tracks: StreamTrack[];
  combine: boolean;
  durationSeconds: number;
  estimatedBytes: number | null;
  resolution: string | null;
}

const ATTRIBUTE = /([A-Z0-9-]+)=("[^"]*"|[^,]*)/g;
const MAX_SEGMENTS = 20_000;
const FRAGMENTED_EXTENSIONS = new Set(['m4s', 'mp4', 'm4v', 'm4a', 'cmfv', 'cmfa']);
const VIDEO_CODEC = /avc|hvc|hev|vp0?[89]|av01|mp4v/i;

function attributes(line: string): Record<string, string> {
  const result: Record<string, string> = {};
  const body = line.slice(line.indexOf(':') + 1);
  for (const match of body.matchAll(ATTRIBUTE)) {
    const [, key, raw] = match;
    if (key && raw !== undefined) {
      result[key] = raw.replace(/^"|"$/g, '');
    }
  }
  return result;
}

function resolve(uri: string | undefined, base: string): string | null {
  return uri ? (safeHttpUrl(uri, base)?.toString() ?? null) : null;
}

function audioGroups(lines: string[], base: string): Map<string, string> {
  const groups = new Map<string, string>();
  for (const line of lines.filter((item) => item.startsWith('#EXT-X-MEDIA:'))) {
    const media = attributes(line);
    const uri = resolve(media.URI, base);
    const group = media['GROUP-ID'];
    if (media.TYPE !== 'AUDIO' || !uri || !group) {
      continue;
    }
    if (!groups.has(group) || media.DEFAULT === 'YES') {
      groups.set(group, uri);
    }
  }
  return groups;
}

function parseMaster(lines: string[], base: string): HlsMaster {
  const groups = audioGroups(lines, base);
  const variants: HlsVariant[] = [];
  lines.forEach((line, index) => {
    if (!line.startsWith('#EXT-X-STREAM-INF:')) {
      return;
    }
    const info = attributes(line);
    const uri = resolve(lines.slice(index + 1).find((next) => !next.startsWith('#')), base);
    if (!uri) {
      return;
    }
    variants.push({
      uri,
      bandwidth: Number(info['AVERAGE-BANDWIDTH'] ?? info.BANDWIDTH) || 0,
      resolution: info.RESOLUTION ?? null,
      audioUri: info.AUDIO ? (groups.get(info.AUDIO) ?? null) : null,
      codecs: info.CODECS ?? '',
    });
  });
  return { kind: 'master', variants };
}

function parseRange(value: string, previousEnd: number | undefined): StreamSegment['range'] {
  const [lengthText, offsetText] = value.split('@');
  const length = Number(lengthText);
  const start = offsetText === undefined ? (previousEnd ?? 0) : Number(offsetText);
  if (!Number.isInteger(length) || length <= 0 || !Number.isInteger(start) || start < 0) {
    return null;
  }
  return { start, end: start + length - 1 };
}

function parseMedia(lines: string[], base: string): HlsMedia {
  const media: HlsMedia = { kind: 'media', segments: [], init: null, encrypted: false, live: true, durationSeconds: 0, mixedInit: false };
  const rangeEnds = new Map<string, number>();
  let pendingRange: string | null = null;
  for (const line of lines) {
    if (line.startsWith('#EXTINF:')) {
      media.durationSeconds += Number.parseFloat(line.slice(8)) || 0;
    }
    else if (line.startsWith('#EXT-X-MAP:')) {
      const map = attributes(line);
      const url = resolve(map.URI, base);
      const init = url ? { url, range: map.BYTERANGE ? parseRange(map.BYTERANGE, 0) : null } : null;
      if (media.init && (!init || init.url !== media.init.url || JSON.stringify(init.range) !== JSON.stringify(media.init.range))) {
        media.mixedInit = true;
      }
      media.init = init;
    } else if (line.startsWith('#EXT-X-KEY:') && attributes(line).METHOD !== 'NONE') {
      media.encrypted = true;
    } else if (line.startsWith('#EXT-X-BYTERANGE:')) {
      pendingRange = line.slice('#EXT-X-BYTERANGE:'.length);
    } else if (line === '#EXT-X-ENDLIST' || line === '#EXT-X-PLAYLIST-TYPE:VOD') {
      media.live = false;
    } else if (!line.startsWith('#')) {
      const url = resolve(line, base);
      if (!url) {
        continue;
      }
      const range = pendingRange === null ? null : parseRange(pendingRange, rangeEnds.has(url) ? (rangeEnds.get(url) as number) + 1 : undefined);
      if (range) {
        rangeEnds.set(url, range.end);
      }
      media.segments.push({ url, range });
      pendingRange = null;
    }
  }
  return media;
}

export function parsePlaylist(text: string, baseUrl: string): HlsPlaylist | null {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines[0] !== '#EXTM3U') {
    return null;
  }
  return lines.some((line) => line.startsWith('#EXT-X-STREAM-INF:')) ? parseMaster(lines, baseUrl) : parseMedia(lines, baseUrl);
}

function isAudioOnly(variant: HlsVariant): boolean {
  return variant.resolution === null && variant.codecs !== '' && !VIDEO_CODEC.test(variant.codecs);
}

function rankVariants(master: HlsMaster): HlsVariant[] {
  const video = master.variants.filter((variant) => !isAudioOnly(variant));
  const candidates = video.length > 0 ? video : master.variants;
  return [...candidates].sort((a, b) => b.bandwidth - a.bandwidth || Number(a.audioUri !== null) - Number(b.audioUri !== null));
}

export function pickVariant(master: HlsMaster): HlsVariant | null {
  const [best] = rankVariants(master);
  if (!best) {
    return null;
  }
  return best;
}

export function pickMuxedVariant(master: HlsMaster): HlsVariant | null {
  const muxed = rankVariants(master).find((variant) => variant.audioUri === null);
  if (!muxed) {
    return null;
  }
  return muxed;
}

export function trackExtension(media: HlsMedia, kind: StreamTrackKind): string {
  const first = media.segments[0] ? extensionFromPath(new URL(media.segments[0].url)) : null;
  const fragmented = media.init !== null || (first !== null && FRAGMENTED_EXTENSIONS.has(first));
  if (fragmented) {
    return kind === 'audio' ? 'm4a' : 'mp4';
  }
  if (kind === 'audio' && (first === 'aac' || first === 'mp3')) {
    return first;
  }
  return 'ts';
}

export function streamProblem(media: HlsMedia): string | null {
  if (media.encrypted) {
    return 'This stream is encrypted and cannot be downloaded';
  }
  if (media.live) {
    return 'Live streams cannot be downloaded';
  }
  if (media.segments.length === 0) {
    return 'This stream has no video segments';
  }
  if (media.segments.length > MAX_SEGMENTS) {
    return 'This stream is too long to download';
  }
  if (media.mixedInit) {
    return 'This stream changes format partway through and cannot be saved as one file';
  }
  return null;
}

const COMBINABLE_EXTENSIONS = new Set(['mp4', 'm4a']);

export function canCombine(tracks: StreamTrack[]): boolean {
  return tracks.length === 2 && tracks.every((track) => track.init !== null && COMBINABLE_EXTENSIONS.has(track.extension));
}

export function estimateBytes(bandwidth: number, durationSeconds: number): number | null {
  return bandwidth > 0 && durationSeconds > 0 ? Math.round((bandwidth * durationSeconds) / 8) : null;
}

export function matchesStreamDomain(hostname: string, domains: string[]): boolean {
  const host = hostname.toLowerCase().replace(/^www\./, '');
  return domains.some((domain) => host === domain || host.endsWith(`.${domain}`));
}
