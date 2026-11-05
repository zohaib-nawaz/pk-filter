import { formatHour } from '../../core/night';
import type { ScheduledDownload } from '../../core/types';

interface ScheduledListProps {
  items: ScheduledDownload[];
  startHour: number;
  endHour: number;
  onCancel: (id: string) => void;
}

function kindLabel(item: ScheduledDownload): string {
  if (item.audioOnly) {
    return 'Audio';
  }
  return 'Video';
}

function cancelLabel(item: ScheduledDownload): string {
  if (item.error) {
    return 'Remove';
  }
  return 'Cancel';
}

function renderStatus(item: ScheduledDownload) {
  if (item.error) {
    return <span className="block text-xs text-red-600 dark:text-red-400">Could not start: {item.error}</span>;
  }
  return <span className="block text-xs text-neutral-500 dark:text-neutral-400">{kindLabel(item)}</span>;
}

export function ScheduledList({ items, startHour, endHour, onCancel }: ScheduledListProps) {
  if (items.length === 0) {
    return null;
  }
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
        Tonight, {formatHour(startHour)} to {formatHour(endHour)} ({items.length})
      </h2>
      <ul className="flex flex-col gap-1.5">
        {items.map((item) => (
          <li key={item.id} className="flex items-center gap-2 rounded-lg bg-neutral-50 px-3 py-2 dark:bg-neutral-800">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium" title={item.title}>
                {item.title}
              </span>
              {renderStatus(item)}
            </span>
            <button
              type="button"
              onClick={() => onCancel(item.id)}
              className="flex-none rounded-md px-1.5 py-0.5 text-xs font-medium text-emerald-700 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-950/40"
            >
              {cancelLabel(item)}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
