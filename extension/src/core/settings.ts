import { AUTO_COUNTRY, isCountryCode } from './countries';
import { normalizeDomain } from './domain';
import type { FilterMode, Settings, StreamQuality } from './types';

export const DEFAULT_SETTINGS: Settings = {
  enabled: true,
  filterMode: 'all',
  showUnknown: true,
  minCacheMinutes: 0,
  videoDownloader: false,
  videoOnGoogle: true,
  videoOnPages: true,
  videoShowUnavailable: false,
  streamDomains: [],
  preferredIsp: '',
  explainFailures: false,
  streamQuality: 'best',
  saveSubtitles: true,
  nightStartHour: 1,
  nightEndHour: 9,
  country: AUTO_COUNTRY,
  localCheck: true,
};

export const MAX_STREAM_DOMAINS = 50;

export function parseStreamDomain(input: string): string | null {
  const raw = input.trim();
  if (!raw) {
    return null;
  }
  try {
    return normalizeDomain(new URL(raw.includes('://') ? raw : `https://${raw}`).hostname);
  } catch {
    return null;
  }
}

function streamDomainList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const domains = value.map((item) => (typeof item === 'string' ? parseStreamDomain(item) : null)).filter((item): item is string => item !== null);
  return [...new Set(domains)].slice(0, MAX_STREAM_DOMAINS);
}

export const FILTER_MODES: Array<{ value: FilterMode; label: string; hint: string }> = [
  { value: 'all', label: 'Show all websites', hint: 'Only adds status badges' },
  { value: 'hide_blocked', label: 'Hide confirmed blocked', hint: 'Hides results with strong blocking evidence' },
  { value: 'only_accessible', label: 'Show only accessible', hint: 'Hides blocked and possibly blocked results' },
];

export const CHECK_FREQUENCIES: Array<{ value: number; label: string }> = [
  { value: 0, label: 'Automatic (5-20 min)' },
  { value: 60, label: 'Every hour' },
  { value: 360, label: 'Every 6 hours' },
  { value: 1440, label: 'Once a day' },
];

export const STREAM_QUALITIES: Array<{ value: StreamQuality; label: string }> = [
  { value: 'best', label: 'Best available' },
  { value: '1080', label: 'Up to 1080p' },
  { value: '720', label: 'Up to 720p' },
  { value: '480', label: 'Up to 480p (saves data)' },
  { value: '360', label: 'Up to 360p (smallest)' },
];

export function maxHeightFor(quality: StreamQuality): number {
  if (quality === 'best') {
    return Number.POSITIVE_INFINITY;
  }
  return Number(quality);
}

const MODES = new Set<FilterMode>(FILTER_MODES.map((mode) => mode.value));
const FREQUENCIES = new Set(CHECK_FREQUENCIES.map((option) => option.value));
const QUALITIES = new Set<StreamQuality>(STREAM_QUALITIES.map((option) => option.value));

function hour(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 23) {
    return value;
  }
  return fallback;
}

function countryChoice(value: unknown): string {
  if (value === AUTO_COUNTRY || isCountryCode(value)) {
    return value;
  }
  return DEFAULT_SETTINGS.country;
}

function nightWindow(raw: Partial<Record<keyof Settings, unknown>>): Pick<Settings, 'nightStartHour' | 'nightEndHour'> {
  const nightStartHour = hour(raw.nightStartHour, DEFAULT_SETTINGS.nightStartHour);
  const nightEndHour = hour(raw.nightEndHour, DEFAULT_SETTINGS.nightEndHour);
  if (nightStartHour === nightEndHour) {
    return { nightStartHour: DEFAULT_SETTINGS.nightStartHour, nightEndHour: DEFAULT_SETTINGS.nightEndHour };
  }
  return { nightStartHour, nightEndHour };
}

function flag(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

export function sanitizeSettings(input: unknown): Settings {
  if (!input || typeof input !== 'object') {
    return { ...DEFAULT_SETTINGS, streamDomains: [] };
  }
  const raw = input as Partial<Record<keyof Settings, unknown>>;
  return {
    enabled: flag(raw.enabled, DEFAULT_SETTINGS.enabled),
    filterMode: MODES.has(raw.filterMode as FilterMode) ? (raw.filterMode as FilterMode) : DEFAULT_SETTINGS.filterMode,
    showUnknown: flag(raw.showUnknown, DEFAULT_SETTINGS.showUnknown),
    minCacheMinutes: FREQUENCIES.has(raw.minCacheMinutes as number) ? (raw.minCacheMinutes as number) : DEFAULT_SETTINGS.minCacheMinutes,
    videoDownloader: flag(raw.videoDownloader, DEFAULT_SETTINGS.videoDownloader),
    videoOnGoogle: flag(raw.videoOnGoogle, DEFAULT_SETTINGS.videoOnGoogle),
    videoOnPages: flag(raw.videoOnPages, DEFAULT_SETTINGS.videoOnPages),
    videoShowUnavailable: flag(raw.videoShowUnavailable, DEFAULT_SETTINGS.videoShowUnavailable),
    streamDomains: streamDomainList(raw.streamDomains),
    preferredIsp: typeof raw.preferredIsp === 'string' ? raw.preferredIsp.trim().slice(0, 64) : DEFAULT_SETTINGS.preferredIsp,
    explainFailures: flag(raw.explainFailures, DEFAULT_SETTINGS.explainFailures),
    streamQuality: QUALITIES.has(raw.streamQuality as StreamQuality) ? (raw.streamQuality as StreamQuality) : DEFAULT_SETTINGS.streamQuality,
    saveSubtitles: flag(raw.saveSubtitles, DEFAULT_SETTINGS.saveSubtitles),
    ...nightWindow(raw),
    country: countryChoice(raw.country),
    localCheck: flag(raw.localCheck, DEFAULT_SETTINGS.localCheck),
  };
}
