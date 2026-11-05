import { formatBytes } from '../../core/download-errors';
import type { PageVideo } from '../../core/types';
import type { PageVideoState } from '../hooks/usePageVideos';

interface PageVideoListProps {
  videos: PageVideo[];
  states: Record<string, PageVideoState>;
  onDownload: (video: PageVideo) => void;
}

const BUTTON_LABEL: Record<PageVideoState['status'], string> = {
  idle: 'Download',
  starting: 'Starting…',
  started: 'Started',
  error: 'Retry',
};

function fileName(url: string): string {
  try {
    return decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).at(-1) ?? url);
  } catch {
    return url;
  }
}

function renderError(state: PageVideoState) {
  if (state.status !== 'error') {
    return null;
  }
  return <span className="block text-xs text-red-600 dark:text-red-400">{state.message}</span>;
}

export function PageVideoList({ videos, states, onDownload }: PageVideoListProps) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
        Videos on this page ({videos.length})
      </h2>
      <ul className="flex flex-col gap-1.5">
        {videos.map((video, index) => {
          const state = states[video.url] ?? { status: 'idle' };
          const busy = state.status === 'starting' || state.status === 'started';
          return (
            <li
              key={video.url}
              className="flex items-center gap-2.5 rounded-lg border border-neutral-200 px-3 py-2 dark:border-neutral-700"
            >
              <span className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-emerald-600 text-xs font-semibold text-white">
                {index + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium" title={video.url}>
                  {fileName(video.url)}
                </span>
                <span className="block text-xs text-neutral-500 dark:text-neutral-400">
                  {video.extension.toUpperCase()} · {formatBytes(video.sizeBytes)}
                </span>
                {renderError(state)}
              </span>
              <button
                type="button"
                disabled={busy}
                onClick={() => onDownload(video)}
                className="flex-none rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
              >
                {BUTTON_LABEL[state.status]}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
