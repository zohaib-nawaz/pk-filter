import { formatBytes } from '../../core/download-errors';
import { progressPercent } from '../../core/downloads';
import type { DownloadView } from '../../core/types';

export interface DownloadHandlers {
  onPause: (view: DownloadView) => void;
  onResume: (view: DownloadView) => void;
  onCancel: (view: DownloadView) => void;
  onRetry: (view: DownloadView) => void;
  onOpen: (view: DownloadView) => void;
  onShow: (view: DownloadView) => void;
  onRemove: (view: DownloadView) => void;
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

interface ActionSpec {
  label: string;
  run: (view: DownloadView) => void;
}

function sizeText(view: DownloadView): string {
  if (view.state === 'complete') {
    return formatBytes(view.totalBytes);
  }
  if (view.totalBytes) {
    return `${formatBytes(view.bytesReceived)} / ${formatBytes(view.totalBytes)}`;
  }
  return formatBytes(view.bytesReceived);
}

function statusText(view: DownloadView, saving: boolean): string {
  if (saving) {
    return 'Saving file';
  }
  if (view.kind === 'stream' && view.state === 'in_progress') {
    return 'Downloading stream';
  }
  return STATUS_TEXT[view.state];
}

function percentText(percent: number | null, state: DownloadView['state']): string {
  if (percent === null || state === 'complete') {
    return '';
  }
  return ` · ${percent}%`;
}

function barWidth(percent: number | null, state: DownloadView['state']): number {
  if (percent !== null) {
    return percent;
  }
  if (state === 'in_progress') {
    return 15;
  }
  return 0;
}

function renderError(error: string | null | undefined) {
  if (!error) {
    return null;
  }
  return <p className="text-xs text-red-600 dark:text-red-400">{error}</p>;
}

function actionsFor(view: DownloadView, saving: boolean, handlers: DownloadHandlers): ActionSpec[] {
  const { state } = view;
  const running = state === 'in_progress' || state === 'paused';
  const opened = state === 'complete' && view.fileExists;
  const candidates: Array<[boolean, ActionSpec]> = [
    [state === 'in_progress' && !saving, { label: 'Pause', run: handlers.onPause }],
    [state === 'paused', { label: 'Resume', run: handlers.onResume }],
    [running && !saving, { label: 'Cancel', run: handlers.onCancel }],
    [state === 'interrupted' && view.canResume, { label: 'Resume', run: handlers.onResume }],
    [state === 'interrupted' || state === 'cancelled' || state === 'missing', { label: 'Retry', run: handlers.onRetry }],
    [opened, { label: 'Open', run: handlers.onOpen }],
    [opened, { label: 'Show in folder', run: handlers.onShow }],
    [!running, { label: 'Remove', run: handlers.onRemove }],
  ];
  return candidates.filter(([shown]) => shown).map(([, action]) => action);
}

export function DownloadItem({ view, ...handlers }: DownloadItemProps) {
  const { record, state } = view;
  const percent = progressPercent(view);
  const saving = view.kind === 'stream' && percent === 100 && state === 'in_progress';

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
        <div className={`h-full ${BAR_COLOR[state]} transition-all`} style={{ width: `${barWidth(percent, state)}%` }} />
      </div>
      <div className="flex items-center justify-between gap-2 text-xs text-neutral-500 dark:text-neutral-400">
        <span>
          {statusText(view, saving)}
          {percentText(percent, state)} · {sizeText(view)}
        </span>
      </div>
      {renderError(view.error)}
      <div className="-ml-1.5 flex flex-wrap gap-0.5">
        {actionsFor(view, saving, handlers).map((action) => (
          <Action key={action.label} label={action.label} onClick={() => action.run(view)} />
        ))}
      </div>
    </li>
  );
}
