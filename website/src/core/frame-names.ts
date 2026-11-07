import { extensionFor, videoName, type Option } from './frames';

export interface NameSettings {
  pattern: string;
  digits: number | null;
  start: number;
}

export interface NameContext {
  title: string;
  width: number;
  height: number;
  fps: number | null;
  date: Date;
}

export interface NamedFrame {
  index: number;
  time: number;
  type: string;
}

export interface NameToken {
  token: string;
  label: string;
}

const FALLBACK_PATTERN = 'frame-{n}';
const UNSAFE = /[\\/:*?"<>|\u0000-\u001f]+/g;
const MAX_NAME_LENGTH = 150;
const MIN_AUTO_DIGITS = 3;
const MAX_START = 999_999;

export const DEFAULT_NAMING: NameSettings = { pattern: FALLBACK_PATTERN, digits: null, start: 1 };

export const NAME_TOKENS: NameToken[] = [
  { token: '{n}', label: 'Number' },
  { token: '{time}', label: 'Time' },
  { token: '{ms}', label: 'Milliseconds' },
  { token: '{title}', label: 'Video name' },
  { token: '{width}', label: 'Width' },
  { token: '{height}', label: 'Height' },
  { token: '{fps}', label: 'Frame rate' },
  { token: '{date}', label: 'Date' },
];

export const NAME_PRESETS: Array<Option<string>> = [
  { value: 'frame-{n}', label: 'frame-001' },
  { value: '{title}-{n}', label: 'video name-001' },
  { value: '{title}-{time}', label: 'video name-0-12.500' },
  { value: '{n}_{time}', label: '001_0-12.500' },
  { value: '{title}_{width}x{height}_{n}', label: 'video name_1280x720_001' },
  { value: '{date}_{title}_{n}', label: '2026-11-07_video name_001' },
];

export const DIGIT_CHOICES: Array<Option<number | null>> = [
  { value: null, label: 'Automatic' },
  { value: 1, label: '1, 2, 3' },
  { value: 2, label: '01, 02, 03' },
  { value: 3, label: '001, 002, 003' },
  { value: 4, label: '0001, 0002' },
  { value: 5, label: '00001, 00002' },
  { value: 6, label: '000001, 000002' },
];

export function clampStart(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_NAMING.start;
  }
  return Math.min(MAX_START, Math.max(0, Math.round(value)));
}

export function timeToken(seconds: number): string {
  const totalMs = Math.round(Math.max(0, seconds) * 1000);
  const hours = Math.floor(totalMs / 3_600_000);
  const minutes = Math.floor((totalMs % 3_600_000) / 60_000);
  const rest = ((totalMs % 60_000) / 1000).toFixed(3).padStart(6, '0');
  if (hours > 0) {
    return `${hours}-${String(minutes).padStart(2, '0')}-${rest}`;
  }
  return `${minutes}-${rest}`;
}

function dateToken(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function digitsFor(naming: NameSettings, total: number): number {
  if (naming.digits !== null) {
    return naming.digits;
  }
  return Math.max(MIN_AUTO_DIGITS, String(clampStart(naming.start) + Math.max(total, 1) - 1).length);
}

function clean(name: string): string {
  return Array.from(name.replace(UNSAFE, '-').replace(/\s+/g, ' ').replace(/^[\s.]+|[\s.]+$/g, ''))
    .slice(0, MAX_NAME_LENGTH)
    .join('')
    .trim();
}

function fill(pattern: string, values: Record<string, string>): string {
  return pattern.replace(/\{([a-z]+)\}/g, (match, key: string) => values[key] ?? match);
}

function uniqueName(name: string, used: Set<string>): string {
  const dot = name.lastIndexOf('.');
  let candidate = name;
  for (let copy = 2; used.has(candidate.toLowerCase()); copy += 1) {
    candidate = `${name.slice(0, dot)}-${copy}${name.slice(dot)}`;
  }
  return candidate;
}

export function nameFrames(frames: NamedFrame[], naming: NameSettings, context: NameContext): string[] {
  const digits = digitsFor(naming, frames.length);
  const start = clampStart(naming.start);
  const shared = {
    title: videoName(context.title),
    width: String(context.width),
    height: String(context.height),
    fps: context.fps === null ? '' : String(Number(context.fps.toFixed(2))),
    date: dateToken(context.date),
  };
  const pattern = naming.pattern.trim() || FALLBACK_PATTERN;
  const used = new Set<string>();
  return frames.map((frame) => {
    const values = { ...shared, n: String(start + frame.index).padStart(digits, '0'), time: timeToken(frame.time), ms: String(Math.round(frame.time * 1000)) };
    const base = clean(fill(pattern, values)) || clean(fill(FALLBACK_PATTERN, values));
    const name = uniqueName(`${base}.${extensionFor(frame.type)}`, used);
    used.add(name.toLowerCase());
    return name;
  });
}

export function previewNames(names: string[]): string[] {
  if (names.length <= 3) {
    return names;
  }
  return [names[0] as string, names[1] as string, '…', names.at(-1) as string];
}

export function appendToken(pattern: string, token: string): string {
  if (!pattern || /[-_. ]$/.test(pattern)) {
    return `${pattern}${token}`;
  }
  return `${pattern}-${token}`;
}

export function presetFor(pattern: string): string | null {
  const match = NAME_PRESETS.find((preset) => preset.value === pattern);
  if (!match) {
    return null;
  }
  return match.value;
}
