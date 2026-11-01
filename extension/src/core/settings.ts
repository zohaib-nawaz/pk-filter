import type { FilterMode, Settings } from './types';

export const DEFAULT_SETTINGS: Settings = {
  enabled: true,
  filterMode: 'all',
  showUnknown: true,
  minCacheMinutes: 0,
};

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

const MODES = new Set<FilterMode>(FILTER_MODES.map((mode) => mode.value));
const FREQUENCIES = new Set(CHECK_FREQUENCIES.map((option) => option.value));

export function sanitizeSettings(input: unknown): Settings {
  const raw = (input ?? {}) as Partial<Record<keyof Settings, unknown>>;
  return {
    enabled: typeof raw.enabled === 'boolean' ? raw.enabled : DEFAULT_SETTINGS.enabled,
    filterMode: MODES.has(raw.filterMode as FilterMode) ? (raw.filterMode as FilterMode) : DEFAULT_SETTINGS.filterMode,
    showUnknown: typeof raw.showUnknown === 'boolean' ? raw.showUnknown : DEFAULT_SETTINGS.showUnknown,
    minCacheMinutes: FREQUENCIES.has(raw.minCacheMinutes as number) ? (raw.minCacheMinutes as number) : DEFAULT_SETTINGS.minCacheMinutes,
  };
}
