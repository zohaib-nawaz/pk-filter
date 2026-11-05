import { StatusBadge } from './StatusBadge';

export interface MockResult {
  site: string;
  url: string;
  title: string;
  status: { label: string; color: string };
}

export function SearchMock({ query, results }: { query: string; results: MockResult[] }) {
  return (
    <div className="w-full rounded-2xl border border-neutral-200 bg-white p-5 shadow-xl shadow-emerald-900/5 dark:border-neutral-800 dark:bg-neutral-900">
      <div className="mb-5 flex items-center gap-3 rounded-full border border-neutral-200 px-4 py-2.5 text-sm text-neutral-700 dark:border-neutral-700 dark:text-neutral-200">
        <svg viewBox="0 0 24 24" className="h-4 w-4 text-neutral-400" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <circle cx="11" cy="11" r="7" />
          <path d="M20 20l-3.5-3.5" />
        </svg>
        {query}
      </div>
      <ul className="flex flex-col gap-5">
        {results.map((result) => (
          <li key={result.url} className="flex flex-col gap-1">
            <span className="text-xs text-neutral-500 dark:text-neutral-400">
              {result.site} · {result.url}
            </span>
            <span className="flex flex-wrap items-center gap-2">
              <span className="text-base font-medium text-blue-700 dark:text-blue-400">{result.title}</span>
              <StatusBadge label={result.status.label} color={result.status.color} />
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
