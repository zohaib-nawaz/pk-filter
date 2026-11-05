import { useState, type FormEvent } from 'react';
import type { SiteCheckState } from '../hooks/useSiteCheck';
import { CheckResultCard } from './CheckResultCard';

interface CheckerProps {
  state: SiteCheckState;
  countries: Array<{ value: string; label: string }>;
  examples: string[];
  onCheck: (input: string, country: string) => void;
}

const FIELD = 'rounded-xl border border-neutral-300 bg-white px-4 py-3 text-base outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/20 dark:border-neutral-700 dark:bg-neutral-900';

function renderState(state: SiteCheckState) {
  if (state.phase === 'checking') {
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-dashed border-neutral-300 p-6 text-sm text-neutral-600 dark:border-neutral-700 dark:text-neutral-300">
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-emerald-600 border-t-transparent" aria-hidden />
        Checking {state.domain}… this can take up to 30 seconds the first time.
      </div>
    );
  }
  if (state.phase === 'error') {
    return <p className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">{state.message}</p>;
  }
  if (state.phase === 'done') {
    return <CheckResultCard view={state.view} />;
  }
  return null;
}

export function Checker({ state, countries, examples, onCheck }: CheckerProps) {
  const [input, setInput] = useState('');
  const [country, setCountry] = useState('auto');
  const busy = state.phase === 'checking';

  const submit = (event: FormEvent) => {
    event.preventDefault();
    onCheck(input, country);
  };

  const tryExample = (example: string) => {
    setInput(example);
    onCheck(example, country);
  };

  return (
    <div className="mt-10 flex flex-col gap-6">
      <form onSubmit={submit} className="grid gap-3 md:grid-cols-[1fr_16rem_auto]">
        <label className="sr-only" htmlFor="check-domain">
          Website
        </label>
        <input
          id="check-domain"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="example.com"
          autoComplete="off"
          inputMode="url"
          className={FIELD}
        />
        <label className="sr-only" htmlFor="check-country">
          Country
        </label>
        <select id="check-country" value={country} onChange={(event) => setCountry(event.target.value)} className={FIELD}>
          {countries.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <button
          type="submit"
          disabled={busy}
          className="rounded-xl bg-emerald-600 px-6 py-3 text-base font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:cursor-wait disabled:opacity-60"
        >
          Check
        </button>
      </form>
      <p className="flex flex-wrap items-center gap-2 text-sm text-neutral-500 dark:text-neutral-400">
        Try:
        {examples.map((example) => (
          <button
            key={example}
            type="button"
            disabled={busy}
            onClick={() => tryExample(example)}
            className="rounded-full border border-neutral-200 px-3 py-1 text-neutral-700 hover:border-emerald-600 hover:text-emerald-700 dark:border-neutral-700 dark:text-neutral-200"
          >
            {example}
          </button>
        ))}
      </p>
      {renderState(state)}
    </div>
  );
}
