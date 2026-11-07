import type { ReactNode } from 'react';
import { MAX_FRAMES, type FrameFormat, type FramePreset, type FrameSettings, type FrameSpacing, type Option } from '../../core/frames';
import { WarningNote } from '../Notice';
import { BUTTON_LARGE, FIELD, FIELDSET, SELECT } from '../styles';
import { ClockField } from './ClockField';

export interface FrameChoices {
  presets: FramePreset[];
  rates: Array<Option<number>>;
  formats: Array<Option<FrameFormat>>;
  heights: Array<Option<number | null>>;
}

export interface ClockFormat {
  format: (seconds: number) => string;
  parse: (text: string) => number | null;
}

interface FrameSettingsPanelProps {
  settings: FrameSettings;
  choices: FrameChoices;
  clock: ClockFormat;
  activePreset: string | null;
  summary: string;
  output: string;
  size: string;
  warning: string | null;
  onChange: (settings: FrameSettings) => void;
  onPreset: (preset: FramePreset) => void;
  onExtract: () => void;
  children?: ReactNode;
}

const PRESET = 'flex flex-col items-start rounded-xl border px-3 py-2 text-left transition-colors';
const PRESET_ON = 'border-emerald-600 bg-emerald-50 ring-2 ring-emerald-600/20 dark:bg-emerald-950/40';
const PRESET_OFF = 'border-neutral-300 hover:border-neutral-400 dark:border-neutral-700';
const ORIGINAL_SIZE = 'original';
const CUSTOM_RATE = 'custom';

function heightValue(height: number | null): string {
  if (height === null) {
    return ORIGINAL_SIZE;
  }
  return String(height);
}

function parseHeight(value: string): number | null {
  if (value === ORIGINAL_SIZE) {
    return null;
  }
  return Number(value);
}

function rateValue(fps: number, rates: Array<Option<number>>): string {
  const match = rates.find((rate) => rate.value === fps);
  if (!match) {
    return CUSTOM_RATE;
  }
  return String(match.value);
}

const SPACINGS: Array<{ value: FrameSpacing; label: string; detail: string }> = [
  { value: 'rate', label: 'By frame rate', detail: 'A frame every set interval' },
  { value: 'count', label: 'Exact number', detail: 'Spread evenly over the part' },
];

function renderSpacing(settings: FrameSettings, rates: Array<Option<number>>, onChange: (settings: FrameSettings) => void) {
  if (settings.spacing === 'count') {
    return (
      <label className="flex items-center gap-2 text-sm">
        <input
          type="number"
          min={1}
          max={MAX_FRAMES}
          step={1}
          value={settings.count}
          onChange={(event) => onChange({ ...settings, count: Number(event.target.value) })}
          className={`${FIELD} w-40 tabular-nums`}
          aria-label="Number of frames"
        />
        frames, evenly spaced
      </label>
    );
  }
  return (
    <div className="grid gap-3 sm:grid-cols-[1fr_9rem]">
      <select aria-label="Frame rate" className={SELECT} value={rateValue(settings.fps, rates)} onChange={(event) => onChange({ ...settings, fps: Number(event.target.value) || settings.fps })}>
        {rates.map((rate) => (
          <option key={rate.value} value={String(rate.value)}>
            {rate.label}
          </option>
        ))}
        <option value={CUSTOM_RATE} disabled>
          Custom
        </option>
      </select>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="number"
          min={0.01}
          max={60}
          step={0.01}
          value={settings.fps}
          onChange={(event) => onChange({ ...settings, fps: Number(event.target.value) })}
          className={`${FIELD} w-full tabular-nums`}
          aria-label="Frames per second"
        />
        fps
      </label>
    </div>
  );
}

function presetClass(active: boolean): string {
  return `${PRESET} ${active ? PRESET_ON : PRESET_OFF}`;
}

function renderWarning(warning: string | null) {
  if (!warning) {
    return null;
  }
  return <WarningNote message={warning} />;
}

export function FrameSettingsPanel({ settings, choices, clock, activePreset, summary, output, size, warning, onChange, onPreset, onExtract, children }: FrameSettingsPanelProps) {
  const lossless = settings.format === 'image/png';

  return (
    <div className="flex flex-col gap-6">
      <fieldset className="grid min-w-0 grid-cols-2 gap-3">
        <legend className="mb-2 font-semibold">Part of the video</legend>
        <ClockField id="frame-start" label="From" value={settings.start} format={clock.format} parse={clock.parse} onCommit={(start) => onChange({ ...settings, start })} />
        <ClockField id="frame-end" label="To" value={settings.end} format={clock.format} parse={clock.parse} onCommit={(end) => onChange({ ...settings, end })} />
      </fieldset>

      <fieldset className={FIELDSET}>
        <legend className="mb-2 font-semibold">How many frames</legend>
        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="How to pick frames">
          {SPACINGS.map((spacing) => (
            <button
              key={spacing.value}
              type="button"
              role="radio"
              aria-checked={settings.spacing === spacing.value}
              onClick={() => onChange({ ...settings, spacing: spacing.value })}
              className={presetClass(settings.spacing === spacing.value)}
            >
              <span className="font-semibold">{spacing.label}</span>
              <span className="text-xs text-neutral-500 dark:text-neutral-400">{spacing.detail}</span>
            </button>
          ))}
        </div>
        {renderSpacing(settings, choices.rates, onChange)}
      </fieldset>

      <fieldset className={FIELDSET}>
        <legend className="mb-2 font-semibold">Quality</legend>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {choices.presets.map((preset) => (
            <button key={preset.id} type="button" aria-pressed={activePreset === preset.id} onClick={() => onPreset(preset)} className={presetClass(activePreset === preset.id)}>
              <span className="font-semibold">{preset.label}</span>
              <span className="text-xs text-neutral-500 dark:text-neutral-400">{preset.detail}</span>
            </button>
          ))}
        </div>
        <details className="rounded-xl border border-neutral-200 px-4 py-3 dark:border-neutral-800">
          <summary className="cursor-pointer text-sm font-medium">Fine tune</summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <label className="flex min-w-0 flex-col gap-1.5 text-sm font-medium">
              Format
              <select className={SELECT} value={settings.format} onChange={(event) => onChange({ ...settings, format: event.target.value as FrameFormat })}>
                {choices.formats.map((format) => (
                  <option key={format.value} value={format.value}>
                    {format.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex min-w-0 flex-col gap-1.5 text-sm font-medium">
              Size
              <select className={SELECT} value={heightValue(settings.maxHeight)} onChange={(event) => onChange({ ...settings, maxHeight: parseHeight(event.target.value) })}>
                {choices.heights.map((height) => (
                  <option key={heightValue(height.value)} value={heightValue(height.value)}>
                    {height.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex min-w-0 flex-col gap-1.5 text-sm font-medium">
              Compression {Math.round(settings.quality * 100)}%
              <input
                type="range"
                min={0.1}
                max={1}
                step={0.01}
                disabled={lossless}
                value={settings.quality}
                onChange={(event) => onChange({ ...settings, quality: Number(event.target.value) })}
                className="mt-3 accent-emerald-600 disabled:opacity-40"
              />
            </label>
          </div>
        </details>
      </fieldset>

      {children}

      <div className="flex flex-col gap-3 rounded-2xl bg-neutral-50 p-4 dark:bg-neutral-900">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-neutral-500 dark:text-neutral-400">Frames</dt>
          <dd className="font-semibold">{summary}</dd>
          <dt className="text-neutral-500 dark:text-neutral-400">Each image</dt>
          <dd>{output}</dd>
          <dt className="text-neutral-500 dark:text-neutral-400">Total size</dt>
          <dd aria-live="polite">{size}</dd>
        </dl>
        {renderWarning(warning)}
        <button type="button" onClick={onExtract} className={BUTTON_LARGE}>
          Extract frames
        </button>
      </div>
    </div>
  );
}
