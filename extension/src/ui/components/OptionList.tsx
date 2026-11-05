interface Option<T extends string> {
  value: T;
  label: string;
  hint?: string;
}

interface OptionListProps<T extends string> {
  name: string;
  value: T;
  options: Option<T>[];
  disabled?: boolean;
  onChange: (value: T) => void;
}

function dimmed(disabled: boolean | undefined): string {
  if (disabled) {
    return 'pointer-events-none opacity-50';
  }
  return '';
}

function optionClass(selected: boolean): string {
  if (selected) {
    return 'border-emerald-600 bg-emerald-50 dark:bg-emerald-950/40';
  }
  return 'border-neutral-200 hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-800';
}

function renderHint(hint: string | undefined) {
  if (!hint) {
    return null;
  }
  return <span className="block text-xs text-neutral-500 dark:text-neutral-400">{hint}</span>;
}

export function OptionList<T extends string>({ name, value, options, disabled, onChange }: OptionListProps<T>) {
  return (
    <div role="radiogroup" className={`flex flex-col gap-1 ${dimmed(disabled)}`}>
      {options.map((option) => (
        <label
          key={option.value}
          className={`flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2 transition-colors ${optionClass(option.value === value)}`}
        >
          <input
            type="radio"
            name={name}
            className="mt-0.5 accent-emerald-600"
            checked={option.value === value}
            onChange={() => onChange(option.value)}
          />
          <span>
            <span className="block text-sm font-medium">{option.label}</span>
            {renderHint(option.hint)}
          </span>
        </label>
      ))}
    </div>
  );
}
