import type { FormatRow } from '../core/media-api';
import { BUTTON } from './styles';

interface FormatListProps {
  heading: string;
  rows: FormatRow[];
}

const TONES: Record<FormatRow['audio']['tone'], string> = {
  good: 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300',
  warn: 'bg-amber-50 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300',
  info: 'bg-sky-50 text-sky-800 dark:bg-sky-950/50 dark:text-sky-300',
};

export function FormatList({ heading, rows }: FormatListProps) {
  return (
    <article className="rounded-2xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
      <header className="border-b border-neutral-200 px-5 py-4 dark:border-neutral-800">
        <h3 className="font-semibold">{heading}</h3>
      </header>
      <ul className="divide-y divide-neutral-200 dark:divide-neutral-800">
        {rows.map((row) => (
          <li key={row.key} className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1.5 px-5 py-4 sm:grid-cols-[8rem_1fr_auto]">
            <span className="text-lg font-semibold tabular-nums">{row.label}</span>
            <a
              href={row.href}
              aria-label={`Download ${row.label}, ${row.audio.text}, ${row.size}`}
              className={`${BUTTON} sm:col-start-3 sm:row-start-1`}
              rel="nofollow"
            >
              Download
            </a>
            <span className="col-span-2 min-w-0 sm:col-span-1 sm:col-start-2 sm:row-start-1">
              <span className="block truncate text-sm text-neutral-700 dark:text-neutral-200" title={row.detail}>
                {row.detail}
              </span>
              <span className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                <span className={`rounded-full px-2 py-0.5 font-medium ${TONES[row.audio.tone]}`}>{row.audio.text}</span>
                <span className="text-neutral-500 dark:text-neutral-400">{row.size}</span>
              </span>
            </span>
          </li>
        ))}
      </ul>
    </article>
  );
}
