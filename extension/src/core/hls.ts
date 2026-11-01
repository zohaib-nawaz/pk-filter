import { extensionFromPath, safeHttpUrl } from './media';

export interface HlsVariant {
  uri: string;
  bandwidth: number;
  resolution: string | null;
  audioUri: string | null;
}

export interface HlsMaster {
  kind: 'master';
  variants: HlsVariant[];
}

export interface StreamSegment {
  url: string;
  range: { start: number; end: number } | null;
}

export interface HlsMedia {
  kind: 'media';
  segments: StreamSegment[];
  init: StreamSegment | null;
  encrypted: boolean;
  live: boolean;
  durationSeconds: number;
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

function attributes(line: string): Record<string, string> {
  const result: Record<string, string> = {};
  const body = line.slice(line.indexOf(':') + 1);
  for (const match of body.matchAll(ATTRIBUTE)) {
    const [, key, raw] = match;
    if (key && raw !== undefined) result[key] = raw.replace(/^"|"$/g, '');
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
    if (media.TYPE !== 'AUDIO' || !uri || !group) continue;
    if (!groups.has(group) || media.DEFAULT === 'YES') groups.set(group, uri);
  }
  return groups;
}

function parseMaster(lines: string[], base: string): HlsMaster {
  const groups = audioGroups(lines, base);
  const variants: HlsVariant[] = [];
  lines.forEach((line, index) => {
    if (!line.startsWith('#EXT-X-STREAM-INF:')) return;
    const info = attributes(line);
    const uri = resolve(lines.slice(index + 1).find((next) => !next.startsWith('#')), base);
    if (!uri) return;
    variants.push({
      uri,
      bandwidth: Number(info['AVERAGE-BANDWIDTH'] ?? info.BANDWIDTH) || 0,
      resolution: info.RESOLUTION ?? null,
      audioUri: info.AUDIO ? (groups.get(info.AUDIO) ?? null) : null,
    });
  });
  return { kind: 'master', variants };
}

function parseRange(value: string, previousEnd: number | undefined): StreamSegment['range'] {
  const [lengthText, offsetText] = value.split('@');
  const length = Number(lengthText);
  const start = offsetText === undefined ? (previousEnd ?? 0) : Number(offsetText);
  if (!Number.isInteger(length) || length <= 0 || !Number.isInteger(start) || start < 0) return null;
  return { start, end: start + length - 1 };
}

function parseMedia(lines: string[], base: string): HlsMedia {
  const media: HlsMedia = { kind: 'media', segments: [], init: null, encrypted: false, live: true, durationSeconds: 0 };
  const rangeEnds = new Map<string, number>();
  let pendingRange: string | null = null;
  for (const line of lines) {
    if (line.startsWith('#EXTINF:')) media.durationSeconds += Number.parseFloat(line.slice(8)) || 0;
    else if (line.startsWith('#EXT-X-MAP:')) {
      const map = attributes(line);
      const url = resolve(map.URI, base);
      media.init = url ? { url, range: map.BYTERANGE ? parseRange(map.BYTERANGE, 0) : null } : null;
    } else if (line.startsWith('#EXT-X-KEY:') && attributes(line).METHOD !== 'NONE') media.encrypted = true;
    else if (line.startsWith('#EXT-X-BYTERANGE:')) pendingRange = line.slice('#EXT-X-BYTERANGE:'.length);
    else if (line === '#EXT-X-ENDLIST' || line === '#EXT-X-PLAYLIST-TYPE:VOD') media.live = false;
    else if (!line.startsWith('#')) {
      const url = resolve(line, base);
      if (!url) continue;
      const range = pendingRange === null ? null : parseRange(pendingRange, rangeEnds.has(url) ? (rangeEnds.get(url) as number) + 1 : undefined);
      if (range) rangeEnds.set(url, range.end);
      media.segments.push({ url, range });
      pendingRange = null;
    }
  }
  return media;
}

export function parsePlaylist(text: string, baseUrl: string): HlsPlaylist | null {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines[0] !== '#EXTM3U') return null;
  return lines.some((line) => line.startsWith('#EXT-X-STREAM-INF:')) ? parseMaster(lines, baseUrl) : parseMedia(lines, baseUrl);
}

export function pickVariant(master: HlsMaster): HlsVariant | null {
  const sorted = [...master.variants].sort((a, b) => b.bandwidth - a.bandwidth);
  return sorted.find((variant) => variant.audioUri === null) ?? sorted[0] ?? null;
}

export function trackExtension(media: HlsMedia, kind: StreamTrackKind): string {
  const first = media.segments[0] ? extensionFromPath(new URL(media.segments[0].url)) : null;
  const fragmented = media.init !== null || (first !== null && FRAGMENTED_EXTENSIONS.has(first));
  if (fragmented) return kind === 'audio' ? 'm4a' : 'mp4';
  if (kind === 'audio' && (first === 'aac' || first === 'mp3')) return first;
  return 'ts';
}

export function streamProblem(media: HlsMedia): string | null {
  if (media.encrypted) return 'This stream is encrypted and cannot be downloaded';
  if (media.live) return 'Live streams cannot be downloaded';
  if (media.segments.length === 0) return 'This stream has no video segments';
  if (media.segments.length > MAX_SEGMENTS) return 'This stream is too long to download';
  return null;
}

export function canCombine(tracks: StreamTrack[]): boolean {
  return tracks.length === 2 && tracks.every((track) => track.init !== null);
}

export function estimateBytes(bandwidth: number, durationSeconds: number): number | null {
  return bandwidth > 0 && durationSeconds > 0 ? Math.round((bandwidth * durationSeconds) / 8) : null;
}

export function matchesStreamDomain(hostname: string, domains: string[]): boolean {
  const host = hostname.toLowerCase().replace(/^www\./, '');
  return domains.some((domain) => host === domain || host.endsWith(`.${domain}`));
}
