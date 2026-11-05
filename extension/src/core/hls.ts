import { extensionFromPath, safeHttpUrl } from './media';
import type { SubtitleTrack } from './subtitles';

export interface HlsVariant {
  uri: string;
  bandwidth: number;
  resolution: string | null;
  audioUri: string | null;
  codecs: string;
  subtitleGroup: string | null;
}

export interface HlsSubtitleOption {
  group: string;
  uri: string;
  language: string;
  isDefault: boolean;
}

export interface HlsMaster {
  kind: 'master';
  variants: HlsVariant[];
  subtitles: HlsSubtitleOption[];
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
  subtitles?: SubtitleTrack | null;
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
  const chosen = new Map<string, { uri: string | null; isDefault: boolean }>();
  for (const line of lines.filter((item) => item.startsWith('#EXT-X-MEDIA:'))) {
    const media = attributes(line);
    const group = media['GROUP-ID'];
    if (media.TYPE !== 'AUDIO' || !group) {
      continue;
    }
    const isDefault = media.DEFAULT === 'YES';
    const current = chosen.get(group);
    if (!current || (isDefault && !current.isDefault)) {
      chosen.set(group, { uri: resolve(media.URI, base), isDefault });
    }
  }
  const groups = new Map<string, string>();
  for (const [group, entry] of chosen) {
    if (entry.uri) {
      groups.set(group, entry.uri);
    }
  }
  return groups;
}

function subtitleOptions(lines: string[], base: string): HlsSubtitleOption[] {
  const options: HlsSubtitleOption[] = [];
  for (const line of lines.filter((item) => item.startsWith('#EXT-X-MEDIA:'))) {
    const media = attributes(line);
    const uri = resolve(media.URI, base);
    const group = media['GROUP-ID'];
    if (media.TYPE !== 'SUBTITLES' || !uri || !group) {
      continue;
    }
    options.push({ group, uri, language: media.LANGUAGE || media.NAME || '', isDefault: media.DEFAULT === 'YES' });
  }
  return options;
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
      subtitleGroup: info.SUBTITLES ?? null,
    });
  });
  return { kind: 'master', variants, subtitles: subtitleOptions(lines, base) };
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

export function isAudioOnlyVariant(variant: HlsVariant): boolean {
  return variant.resolution === null && variant.codecs !== '' && !VIDEO_CODEC.test(variant.codecs);
}

export function shortSide(width: number, height: number): number {
  const sides = [width, height].filter((side) => Number.isFinite(side) && side > 0);
  if (sides.length === 0) {
    return 0;
  }
  return Math.min(...sides);
}

export function heightOf(resolution: string | null): number {
  if (!resolution) {
    return 0;
  }
  const [width, height] = resolution.split('x').map(Number);
  return shortSide(width as number, height as number);
}

export function capByHeight<T>(items: T[], maxHeight: number, height: (item: T) => number): T[] {
  if (!Number.isFinite(maxHeight)) {
    return items;
  }
  const known = items.filter((item) => height(item) > 0);
  if (known.length === 0) {
    return items;
  }
  const fitting = known.filter((item) => height(item) <= maxHeight);
  if (fitting.length > 0) {
    return fitting;
  }
  const lowest = Math.min(...known.map(height));
  return known.filter((item) => height(item) === lowest);
}

function rankVariants(master: HlsMaster, maxHeight: number): HlsVariant[] {
  const video = master.variants.filter((variant) => !isAudioOnlyVariant(variant));
  const candidates = capByHeight(video.length > 0 ? video : master.variants, maxHeight, (variant) => heightOf(variant.resolution));
  return [...candidates].sort((a, b) => b.bandwidth - a.bandwidth || Number(a.audioUri !== null) - Number(b.audioUri !== null));
}

export function pickSubtitles(master: HlsMaster, variant: HlsVariant): HlsSubtitleOption | null {
  const group = master.subtitles.filter((option) => !variant.subtitleGroup || option.group === variant.subtitleGroup);
  const chosen = group.find((option) => option.isDefault) || group[0];
  if (!chosen) {
    return null;
  }
  return chosen;
}

export function pickVariant(master: HlsMaster, maxHeight = Number.POSITIVE_INFINITY): HlsVariant | null {
  const [best] = rankVariants(master, maxHeight);
  if (!best) {
    return null;
  }
  return best;
}

export function pickMuxedVariant(master: HlsMaster, maxHeight = Number.POSITIVE_INFINITY): HlsVariant | null {
  const muxed = rankVariants(master, maxHeight).find((variant) => variant.audioUri === null);
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

export function audioOnlyPlan(plan: StreamPlan): StreamPlan | null {
  const audio = plan.tracks.find((track) => track.kind === 'audio');
  if (!audio || plan.tracks.length < 2) {
    return null;
  }
  return { ...plan, tracks: [audio], combine: false, resolution: null, estimatedBytes: null, subtitles: null };
}
