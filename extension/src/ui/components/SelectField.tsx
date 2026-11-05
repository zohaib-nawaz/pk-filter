interface SelectOption<T extends string | number> {
  value: T;
  label: string;
}

interface SelectFieldProps<T extends string | number> {
  label?: string;
  hint?: string;
  value: T;
  options: SelectOption<T>[];
  disabled?: boolean;
  isOptionDisabled?: (value: T) => boolean;
  onChange: (value: T) => void;
}

const SELECT_CLASS = 'w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900';

function renderLabel(label: string | undefined) {
  if (!label) {
    return null;
  }
  return <span className="text-sm font-medium">{label}</span>;
}

function renderHint(hint: string | undefined) {
  if (!hint) {
    return null;
  }
  return <span className="text-xs text-neutral-500 dark:text-neutral-400">{hint}</span>;
}

function optionDisabled<T extends string | number>(value: T, isOptionDisabled: ((value: T) => boolean) | undefined): boolean {
  if (!isOptionDisabled) {
    return false;
  }
  return isOptionDisabled(value);
}

export function SelectField<T extends string | number>({ label, hint, value, options, disabled, isOptionDisabled, onChange }: SelectFieldProps<T>) {
  const choose = (raw: string) => {
    const picked = options.find((option) => String(option.value) === raw);
    if (picked) {
      onChange(picked.value);
    }
  };
  return (
    <label className="flex flex-col gap-1.5">
      {renderLabel(label)}
      <select className={SELECT_CLASS} value={String(value)} disabled={disabled} onChange={(event) => choose(event.target.value)}>
        {options.map((option) => (
          <option key={String(option.value)} value={String(option.value)} disabled={optionDisabled(option.value, isOptionDisabled)}>
            {option.label}
          </option>
        ))}
      </select>
      {renderHint(hint)}
    </label>
  );
}
