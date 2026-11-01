interface TabOption<T extends string> {
  value: T;
  label: string;
}

interface TabsProps<T extends string> {
  value: T;
  options: TabOption<T>[];
  onChange: (value: T) => void;
}

export function Tabs<T extends string>({ value, options, onChange }: TabsProps<T>) {
  return (
    <div role="tablist" className="grid grid-flow-col gap-1 rounded-lg bg-neutral-100 p-1 dark:bg-neutral-800">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={option.value === value}
          onClick={() => onChange(option.value)}
          className={`rounded-md px-2 py-1.5 text-xs font-medium transition-colors ${
            option.value === value
              ? 'bg-white shadow-sm dark:bg-neutral-700'
              : 'text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-100'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
