import { formatBytes } from '@shared/download-errors';
import { API_URL } from './config';

export type AudioState = 'included' | 'only' | 'none';

export interface VideoFormat {
  label: string;
  detail: string;
  height: number | null;
  sizeBytes: number | null;
  exactSize: boolean;
  container: string;
  audio: AudioState;
  token: string;
}

export interface VideoPreview {
  thumbnailUrl: string | null;
  mediaUrl: string | null;
  audioOnly: boolean;
}

export interface VideoEmbed {
  provider: 'tiktok';
  playerUrl: string;
  openUrl: string;
  author: string | null;
  authorUrl: string | null;
}

export interface VideoLookup {
  title: string;
  source: 'file' | 'hls' | 'dash' | 'page' | 'tiktok';
  durationSeconds: number | null;
  preview: VideoPreview;
  embed: VideoEmbed | null;
  formats: VideoFormat[];
}

interface LookupBody {
  title?: unknown;
  source?: unknown;
  durationSeconds?: unknown;
  thumbnail?: unknown;
  preview?: { token?: unknown; audioOnly?: unknown } | null;
  embed?: { provider?: unknown; playerUrl?: unknown; openUrl?: unknown; author?: unknown; authorUrl?: unknown } | null;
  formats?: unknown;
}

export interface FormatRow {
  key: string;
  label: string;
  detail: string;
  size: string;
  audio: { text: string; tone: 'good' | 'warn' | 'info' };
  href: string;
}

export class LookupError extends Error {}

const AUDIO_TEXT: Record<AudioState, FormatRow['audio']> = {
  included: { text: 'With sound', tone: 'good' },
  only: { text: 'Audio only', tone: 'info' },
  none: { text: 'No sound', tone: 'warn' },
};

const SOURCE_TEXT: Record<VideoLookup['source'], string> = {
  file: 'Direct video file',
  hls: 'HLS stream',
  dash: 'DASH stream',
  page: 'Found on the page',
  tiktok: 'TikTok video',
};

const TIKTOK_PREFIX = 'https://www.tiktok.com/';

function isFormat(value: unknown): value is VideoFormat {
  const item = value as Partial<VideoFormat> | null;
  return !!item && typeof item.label === 'string' && typeof item.token === 'string' && typeof item.container === 'string';
}

async function errorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { message?: unknown };
    if (typeof body.message === 'string' && body.message) {
      return body.message;
    }
  } catch {
    return 'The download service had a problem. Try again.';
  }
  return 'The download service had a problem. Try again.';
}

function mediaRoute(route: 'thumbnail' | 'preview', token: unknown): string | null {
  if (typeof token !== 'string' || !token) {
    return null;
  }
  return `${API_URL}/api/v1/media/${route}?t=${encodeURIComponent(token)}`;
}

function tiktokLink(value: unknown): string | null {
  if (typeof value !== 'string' || !value.startsWith(TIKTOK_PREFIX)) {
    return null;
  }
  return value;
}

function optionalText(value: unknown): string | null {
  if (typeof value !== 'string' || !value) {
    return null;
  }
  return value;
}

function embedFrom(body: LookupBody): VideoEmbed | null {
  const embed = body.embed && typeof body.embed === 'object' ? body.embed : null;
  if (!embed || embed.provider !== 'tiktok') {
    return null;
  }
  const playerUrl = tiktokLink(embed.playerUrl);
  const openUrl = tiktokLink(embed.openUrl);
  if (!playerUrl || !openUrl || !playerUrl.startsWith(`${TIKTOK_PREFIX}player/`)) {
    return null;
  }
  return { provider: 'tiktok', playerUrl, openUrl, author: optionalText(embed.author), authorUrl: tiktokLink(embed.authorUrl) };
}

function previewFrom(body: LookupBody): VideoPreview {
  const preview = body.preview && typeof body.preview === 'object' ? body.preview : null;
  return {
    thumbnailUrl: mediaRoute('thumbnail', body.thumbnail),
    mediaUrl: preview ? mediaRoute('preview', preview.token) : null,
    audioOnly: preview ? preview.audioOnly === true : false,
  };
}

export function bestQuality(lookup: VideoLookup): string | null {
  const heights = lookup.formats.map((format) => format.height).filter((height): height is number => height !== null);
  if (heights.length === 0) {
    return null;
  }
  return `${Math.max(...heights)}p`;
}

export function lookupErrorMessage(error: unknown): string {
  if (error instanceof LookupError) {
    return error.message;
  }
  return 'Something went wrong. Try again.';
}

export async function postMedia<T>(route: 'formats' | 'thumbnails', url: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_URL}/api/v1/media/${route}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url }),
      signal: AbortSignal.timeout(60_000),
    });
  } catch {
    throw new LookupError('Could not reach the download service.');
  }
  if (response.status === 429) {
    throw new LookupError('Too many lookups from your network. Wait a minute and try again.');
  }
  if (!response.ok) {
    throw new LookupError(await errorMessage(response));
  }
  return (await response.json()) as T;
}

export function thumbnailHref(token: string, download: boolean): string {
  const route = mediaRoute('thumbnail', token) as string;
  if (!download) {
    return route;
  }
  return `${route}&download=1`;
}

export async function lookupVideo(url: string): Promise<VideoLookup> {
  const body = await postMedia<LookupBody>('formats', url);
  const formats = Array.isArray(body.formats) ? body.formats.filter(isFormat) : [];
  return {
    title: typeof body.title === 'string' ? body.title : 'Video',
    source: typeof body.source === 'string' && body.source in SOURCE_TEXT ? (body.source as VideoLookup['source']) : 'file',
    durationSeconds: typeof body.durationSeconds === 'number' ? body.durationSeconds : null,
    preview: previewFrom(body),
    embed: embedFrom(body),
    formats,
  };
}

export function downloadHref(token: string): string {
  return `${API_URL}/api/v1/media/download?t=${encodeURIComponent(token)}`;
}

function sizeText(format: VideoFormat): string {
  if (format.sizeBytes === null) {
    return 'Size unknown';
  }
  if (format.exactSize) {
    return formatBytes(format.sizeBytes);
  }
  return `about ${formatBytes(format.sizeBytes)}`;
}

export function formatRows(lookup: VideoLookup): FormatRow[] {
  return lookup.formats.map((format, index) => ({
    key: `${format.label}-${index}`,
    label: format.label,
    detail: format.detail,
    size: sizeText(format),
    audio: AUDIO_TEXT[format.audio],
    href: downloadHref(format.token),
  }));
}

export function lookupSummary(lookup: VideoLookup): string {
  const parts = [SOURCE_TEXT[lookup.source]];
  if (lookup.embed) {
    if (lookup.embed.author) {
      parts.push(`by ${lookup.embed.author}`);
    }
    return parts.join(' · ');
  }
  if (lookup.durationSeconds !== null && lookup.durationSeconds > 0) {
    parts.push(formatDuration(lookup.durationSeconds));
  }
  parts.push(`${lookup.formats.length} ${lookup.formats.length === 1 ? 'format' : 'formats'}`);
  return parts.join(' · ');
}

export function formatDuration(seconds: number): string {
  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = String(total % 60).padStart(2, '0');
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${rest}`;
  }
  return `${minutes}:${rest}`;
}
