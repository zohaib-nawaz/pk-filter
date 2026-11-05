interface SwitchProps {
  checked: boolean;
  label: string;
  description?: string;
  onChange: (checked: boolean) => void;
}

function renderDescription(description: string | undefined) {
  if (!description) {
    return null;
  }
  return <span className="block text-xs text-neutral-500 dark:text-neutral-400">{description}</span>;
}

function trackClass(checked: boolean): string {
  if (checked) {
    return 'bg-emerald-600';
  }
  return 'bg-neutral-300 dark:bg-neutral-600';
}

function knobClass(checked: boolean): string {
  if (checked) {
    return 'translate-x-4';
  }
  return '';
}

export function Switch({ checked, label, description, onChange }: SwitchProps) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-4">
      <span className="min-w-0">
        <span className="block text-sm font-medium">{label}</span>
        {renderDescription(description)}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={`relative h-5 w-9 flex-none rounded-full transition-colors ${trackClass(checked)}`}
      >
        <span className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${knobClass(checked)}`} />
      </button>
    </label>
  );
}
