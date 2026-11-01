import { formatBytes } from '../../core/download-errors';
import { progressPercent } from '../../core/downloads';
import type { DownloadView } from '../../core/types';

export interface DownloadHandlers {
  onPause: (id: number) => void;
  onResume: (id: number) => void;
  onCancel: (id: number) => void;
  onRetry: (view: DownloadView) => void;
  onOpen: (id: number) => void;
  onShow: (id: number) => void;
  onRemove: (id: number) => void;
}

interface DownloadItemProps extends DownloadHandlers {
  view: DownloadView;
}

const STATUS_TEXT: Record<DownloadView['state'], string> = {
  in_progress: 'Downloading',
  paused: 'Paused',
  complete: 'Completed',
  interrupted: 'Failed',
  cancelled: 'Cancelled',
  missing: 'Removed',
};

const BAR_COLOR: Record<DownloadView['state'], string> = {
  in_progress: 'bg-emerald-600',
  paused: 'bg-amber-500',
  complete: 'bg-emerald-600',
  interrupted: 'bg-red-500',
  cancelled: 'bg-neutral-400',
  missing: 'bg-neutral-400',
};

function Action({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-md px-1.5 py-0.5 text-xs font-medium text-emerald-700 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-950/40"
    >
      {label}
    </button>
  );
}

export function DownloadItem({ view, onPause, onResume, onCancel, onRetry, onOpen, onShow, onRemove }: DownloadItemProps) {
  const { record, state } = view;
  const percent = progressPercent(view);
  const size = view.totalBytes ? `${formatBytes(view.bytesReceived)} / ${formatBytes(view.totalBytes)}` : formatBytes(view.bytesReceived);
  const canRetry = state === 'interrupted' || state === 'cancelled' || state === 'missing';

  return (
    <li className="flex flex-col gap-1.5 py-2.5">
      <div className="flex items-start justify-between gap-2">
        <p className="line-clamp-2 text-sm font-medium" title={record.title}>
          {record.title}
        </p>
        <span className="flex-none rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
          {record.extension}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800">
        <div className={`h-full ${BAR_COLOR[state]} transition-all`} style={{ width: `${percent ?? (state === 'in_progress' ? 15 : 0)}%` }} />
      </div>
      <div className="flex items-center justify-between gap-2 text-xs text-neutral-500 dark:text-neutral-400">
        <span>
          {STATUS_TEXT[state]}
          {percent !== null && state !== 'complete' ? ` · ${percent}%` : ''} · {state === 'complete' ? formatBytes(view.totalBytes) : size}
        </span>
      </div>
      {view.error && <p className="text-xs text-red-600 dark:text-red-400">{view.error}</p>}
      <div className="-ml-1.5 flex flex-wrap gap-0.5">
        {state === 'in_progress' && <Action label="Pause" onClick={() => onPause(record.id)} />}
        {state === 'paused' && <Action label="Resume" onClick={() => onResume(record.id)} />}
        {(state === 'in_progress' || state === 'paused') && <Action label="Cancel" onClick={() => onCancel(record.id)} />}
        {state === 'interrupted' && view.canResume && <Action label="Resume" onClick={() => onResume(record.id)} />}
        {canRetry && <Action label="Retry" onClick={() => onRetry(view)} />}
        {state === 'complete' && view.fileExists && <Action label="Open" onClick={() => onOpen(record.id)} />}
        {state === 'complete' && view.fileExists && <Action label="Show in folder" onClick={() => onShow(record.id)} />}
        {state !== 'in_progress' && state !== 'paused' && <Action label="Remove" onClick={() => onRemove(record.id)} />}
      </div>
    </li>
  );
}
