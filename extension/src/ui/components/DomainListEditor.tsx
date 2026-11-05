import { useState, type FormEvent } from 'react';

interface DomainListEditorProps {
  domains: string[];
  disabled?: boolean;
  placeholder: string;
  onAdd: (input: string) => string | null;
  onRemove: (domain: string) => void;
}

function renderError(error: string | null) {
  if (!error) {
    return null;
  }
  return <p className="text-xs text-red-600 dark:text-red-400">{error}</p>;
}

function dimmed(disabled: boolean | undefined): string {
  if (disabled) {
    return 'pointer-events-none opacity-50';
  }
  return '';
}

export function DomainListEditor({ domains, disabled, placeholder, onAdd, onRemove }: DomainListEditorProps) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const problem = onAdd(value);
    setError(problem);
    if (!problem) {
      setValue('');
    }
  };

  const renderDomains = () => {
    if (domains.length === 0) {
      return null;
    }
    return (
      <ul className="flex flex-wrap gap-1.5">
        {domains.map((domain) => (
          <li
            key={domain}
            className="flex items-center gap-1 rounded-full border border-neutral-200 py-0.5 pr-1 pl-2.5 text-xs dark:border-neutral-700"
          >
            {domain}
            <button
              type="button"
              aria-label={`Remove ${domain}`}
              onClick={() => onRemove(domain)}
              className="rounded-full px-1.5 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800 dark:hover:bg-neutral-800"
            >
              ×
            </button>
          </li>
        ))}
      </ul>
    );
  };

  return (
    <div className={`flex flex-col gap-2 ${dimmed(disabled)}`}>
      <form onSubmit={submit} className="flex gap-2">
        <input
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder={placeholder}
          className="min-w-0 flex-1 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
        />
        <button type="submit" className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700">
          Add
        </button>
      </form>
      {renderError(error)}
      {renderDomains()}
    </div>
  );
}
