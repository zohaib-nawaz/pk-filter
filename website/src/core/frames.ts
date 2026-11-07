import { formatBytes } from '@shared/download-errors';

export type FrameFormat = 'image/jpeg' | 'image/webp' | 'image/png';

export type FrameSpacing = 'rate' | 'count';

export interface FrameSettings {
  start: number;
  end: number;
  spacing: FrameSpacing;
  fps: number;
  count: number;
  format: FrameFormat;
  quality: number;
  maxHeight: number | null;
}

export interface FramePreset {
  id: string;
  label: string;
  detail: string;
  format: FrameFormat;
  quality: number;
  maxHeight: number | null;
}

export interface Option<T> {
  value: T;
  label: string;
}

export interface FramePlan {
  times: number[];
  wanted: number;
  capped: boolean;
}

export const MAX_FRAMES = 600;
export const MIN_FPS = 0.01;
export const MAX_FPS = 60;

export const FRAME_PRESETS: FramePreset[] = [
  { id: 'hd', label: 'HD', detail: 'Full size JPG at 92%', format: 'image/jpeg', quality: 0.92, maxHeight: null },
  { id: 'lossless', label: 'Lossless', detail: 'Full size PNG, largest files', format: 'image/png', quality: 1, maxHeight: null },
  { id: 'medium', label: 'Medium', detail: 'Up to 720p JPG at 80%', format: 'image/jpeg', quality: 0.8, maxHeight: 720 },
  { id: 'low', label: 'Low', detail: 'Up to 480p JPG at 65%', format: 'image/jpeg', quality: 0.65, maxHeight: 480 },
  { id: 'compressed', label: 'Compressed', detail: 'Up to 360p WebP at 50%, smallest files', format: 'image/webp', quality: 0.5, maxHeight: 360 },
];

export const FRAME_RATES: Array<Option<number>> = [
  { value: 0.1, label: '1 frame every 10 seconds' },
  { value: 0.2, label: '1 frame every 5 seconds' },
  { value: 0.5, label: '1 frame every 2 seconds' },
  { value: 1, label: '1 frame per second' },
  { value: 2, label: '2 frames per second' },
  { value: 5, label: '5 frames per second' },
  { value: 10, label: '10 frames per second' },
  { value: 24, label: '24 frames per second' },
  { value: 30, label: '30 frames per second' },
];

export const FRAME_FORMATS: Array<Option<FrameFormat>> = [
  { value: 'image/jpeg', label: 'JPG' },
  { value: 'image/webp', label: 'WebP' },
  { value: 'image/png', label: 'PNG (lossless)' },
];

export const FRAME_HEIGHTS: Array<Option<number | null>> = [
  { value: null, label: 'Original size' },
  { value: 2160, label: 'Up to 2160p (4K)' },
  { value: 1080, label: 'Up to 1080p' },
  { value: 720, label: 'Up to 720p' },
  { value: 480, label: 'Up to 480p' },
  { value: 360, label: 'Up to 360p' },
  { value: 240, label: 'Up to 240p' },
];

const EXTENSIONS: Record<string, string> = { 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/png': 'png' };
const CLOCK = /^(?:(\d+):)?(?:(\d+):)?(\d+(?:\.\d+)?)$/;

export function defaultSettings(duration: number): FrameSettings {
  const preset = FRAME_PRESETS[0] as FramePreset;
  return { start: 0, end: duration, spacing: 'rate', fps: 1, count: 10, format: preset.format, quality: preset.quality, maxHeight: preset.maxHeight };
}

export function applyPreset(settings: FrameSettings, preset: FramePreset): FrameSettings {
  return { ...settings, format: preset.format, quality: preset.quality, maxHeight: preset.maxHeight };
}

export function activePreset(settings: FrameSettings): string | null {
  const match = FRAME_PRESETS.find(
    (preset) => preset.format === settings.format && preset.quality === settings.quality && preset.maxHeight === settings.maxHeight,
  );
  if (!match) {
    return null;
  }
  return match.id;
}

export function clampFps(value: number): number {
  if (!Number.isFinite(value)) {
    return 1;
  }
  return Math.min(MAX_FPS, Math.max(MIN_FPS, value));
}

export function clampCount(value: number): number {
  if (!Number.isFinite(value)) {
    return 1;
  }
  return Math.min(MAX_FRAMES, Math.max(1, Math.round(value)));
}

function evenlySpaced(start: number, end: number, count: number): number[] {
  if (count === 1 || end <= start) {
    return [start];
  }
  const step = (end - start) / (count - 1);
  return Array.from({ length: count }, (_, index) => start + index * step);
}

function byCount(start: number, end: number, count: number): { times: number[]; wanted: number } {
  const wanted = clampCount(count);
  return { times: evenlySpaced(start, end, wanted), wanted };
}

function byRate(start: number, end: number, fps: number): { times: number[]; wanted: number } {
  const step = 1 / clampFps(fps);
  const wanted = Math.floor((end - start) / step + 1e-9) + 1;
  const times = Array.from({ length: Math.min(wanted, MAX_FRAMES) }, (_, index) => start + index * step);
  return { times, wanted };
}

export function planFrames(settings: FrameSettings, duration: number): FramePlan {
  const last = Math.max(0, duration - 0.001);
  const start = Math.min(Math.max(0, settings.start), last);
  const end = Math.min(Math.max(start, settings.end), last);
  const planned = settings.spacing === 'count' ? byCount(start, end, settings.count) : byRate(start, end, settings.fps);
  const times = planned.times.map((time) => Math.round(time * 1000) / 1000);
  return { times, wanted: planned.wanted, capped: planned.wanted > MAX_FRAMES };
}

export function outputSize(width: number, height: number, maxHeight: number | null): { width: number; height: number } {
  const short = Math.min(width, height);
  if (maxHeight === null || short <= maxHeight || short <= 0) {
    return { width, height };
  }
  const scale = maxHeight / short;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

export function extensionFor(type: string): string {
  return EXTENSIONS[type] || 'jpg';
}

export function formatClock(seconds: number): string {
  const safe = Math.max(0, seconds);
  const minutes = Math.floor(safe / 60);
  const rest = (safe - minutes * 60).toFixed(3).padStart(6, '0');
  return `${minutes}:${rest}`;
}

export function parseClock(text: string): number | null {
  const match = CLOCK.exec(text.trim());
  if (!match) {
    return null;
  }
  const parts = [match[1], match[2], match[3]].filter((part): part is string => part !== undefined).map(Number);
  return parts.reduce((total, part) => total * 60 + part, 0);
}

export function videoName(title: string): string {
  return title.replace(/\.[a-z0-9]{2,4}$/i, '').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'video';
}

export function archiveName(title: string): string {
  return `${videoName(title)} frames.zip`;
}

const FORMAT_NAMES: Record<FrameFormat, string> = { 'image/jpeg': 'JPG', 'image/webp': 'WebP', 'image/png': 'PNG' };

export function describeOutput(width: number, height: number, settings: FrameSettings): string {
  const size = outputSize(width, height, settings.maxHeight);
  const quality = settings.format === 'image/png' ? 'lossless' : `${Math.round(settings.quality * 100)}%`;
  return `${size.width} × ${size.height} ${FORMAT_NAMES[settings.format]}, ${quality}`;
}

const SAMPLE_POINTS = [0.2, 0.5, 0.8];

export function sampleTimes(duration: number): number[] {
  return SAMPLE_POINTS.map((point) => Math.round(point * Math.max(0, duration - 0.001) * 1000) / 1000);
}

export function sampleKey(settings: FrameSettings): string {
  return `${settings.format}|${settings.quality}|${settings.maxHeight}`;
}

export function describeSize(bytesPerFrame: number | null, count: number): string {
  if (bytesPerFrame === null) {
    return 'working out the size…';
  }
  return `about ${formatBytes(bytesPerFrame * count)} (${formatBytes(bytesPerFrame)} each)`;
}

export function describePlan(plan: FramePlan): string {
  const count = plan.times.length;
  const noun = count === 1 ? 'frame' : 'frames';
  if (!plan.capped) {
    return `${count} ${noun}`;
  }
  return `${count} ${noun} (first ${MAX_FRAMES} of ${plan.wanted})`;
}
