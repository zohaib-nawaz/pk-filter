import type { NameSettings, NameToken } from '../../core/frame-names';
import type { Option } from '../../core/frames';
import { BUTTON_QUIET_SMALL, FIELD, FIELDSET, SELECT } from '../styles';

export interface NamingChoices {
  presets: Array<Option<string>>;
  tokens: NameToken[];
  digits: Array<Option<number | null>>;
}

export interface NamingRules {
  presetFor: (pattern: string) => string | null;
  appendToken: (pattern: string, token: string) => string;
  clampStart: (value: number) => number;
}

interface FrameNamingProps {
  naming: NameSettings;
  choices: NamingChoices;
  rules: NamingRules;
  preview: string[];
  onChange: (naming: NameSettings) => void;
}

const CUSTOM = 'custom';
const AUTO_DIGITS = 'auto';

function digitsValue(digits: number | null): string {
  if (digits === null) {
    return AUTO_DIGITS;
  }
  return String(digits);
}

function parseDigits(value: string): number | null {
  if (value === AUTO_DIGITS) {
    return null;
  }
  return Number(value);
}

export function FrameNaming({ naming, choices, rules, preview, onChange }: FrameNamingProps) {
  const preset = rules.presetFor(naming.pattern) ?? CUSTOM;

  return (
    <fieldset className={FIELDSET}>
      <legend className="mb-2 font-semibold">File names</legend>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="flex min-w-0 flex-col gap-1.5 text-sm font-medium">
          Style
          <select
            className={SELECT}
            value={preset}
            onChange={(event) => {
              if (event.target.value !== CUSTOM) {
                onChange({ ...naming, pattern: event.target.value });
              }
            }}
          >
            {choices.presets.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
            <option value={CUSTOM}>Custom</option>
          </select>
        </label>
        <label className="flex min-w-0 flex-col gap-1.5 text-sm font-medium">
          Numbers
          <select className={SELECT} value={digitsValue(naming.digits)} onChange={(event) => onChange({ ...naming, digits: parseDigits(event.target.value) })}>
            {choices.digits.map((option) => (
              <option key={digitsValue(option.value)} value={digitsValue(option.value)}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-w-0 flex-col gap-1.5 text-sm font-medium">
          Start counting at
          <input
            type="number"
            min={0}
            step={1}
            value={naming.start}
            onChange={(event) => onChange({ ...naming, start: rules.clampStart(Number(event.target.value)) })}
            className={`${FIELD} w-full tabular-nums`}
          />
        </label>
      </div>
      <label className="flex min-w-0 flex-col gap-1.5 text-sm font-medium">
        Name pattern
        <input
          value={naming.pattern}
          onChange={(event) => onChange({ ...naming, pattern: event.target.value })}
          spellCheck={false}
          autoComplete="off"
          placeholder="frame-{n}"
          className={`${FIELD} w-full font-mono`}
        />
      </label>
      <div className="flex flex-wrap items-center gap-2" aria-label="Add a variable">
        <span className="text-xs font-semibold uppercase tracking-wider text-neutral-400">Add</span>
        {choices.tokens.map((item) => (
          <button key={item.token} type="button" className={BUTTON_QUIET_SMALL} title={item.token} onClick={() => onChange({ ...naming, pattern: rules.appendToken(naming.pattern, item.token) })}>
            {item.label}
          </button>
        ))}
      </div>
      <ol aria-label="Example file names" className="flex flex-col gap-0.5 rounded-xl bg-neutral-50 px-3 py-2 font-mono text-xs break-all text-neutral-600 dark:bg-neutral-900 dark:text-neutral-300">
        {preview.map((name, index) => (
          <li key={`${index}-${name}`}>{name}</li>
        ))}
      </ol>
    </fieldset>
  );
}
