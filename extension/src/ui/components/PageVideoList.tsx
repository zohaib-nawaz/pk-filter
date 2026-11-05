import { formatBytes } from '../../core/download-errors';
import type { PageVideo } from '../../core/types';
import type { PageVideoAction, PageVideoState } from '../hooks/usePageVideos';

interface PageVideoListProps {
  videos: PageVideo[];
  states: Record<string, PageVideoState>;
  onAction: (video: PageVideo, action: PageVideoAction) => void;
}

const BUTTON_LABEL: Record<PageVideoState['status'], string> = {
  idle: 'Download',
  starting: 'Starting…',
  started: 'Started',
  scheduled: 'Download',
  error: 'Retry',
};

const IDLE: PageVideoState = { status: 'idle' };

function fileName(url: string): string {
  try {
    const last = new URL(url).pathname.split('/').filter(Boolean).at(-1);
    if (!last) {
      return url;
    }
    return decodeURIComponent(last);
  } catch {
    return url;
  }
}

function stateOf(states: Record<string, PageVideoState>, video: PageVideo): PageVideoState {
  const state = states[video.url];
  if (!state) {
    return IDLE;
  }
  return state;
}

function scheduledText(startsNow: boolean): string {
  if (startsNow) {
    return 'Night time is on, starting now';
  }
  return 'Scheduled for tonight';
}

function renderNote(state: PageVideoState) {
  if (state.status === 'error') {
    return <span className="block text-xs text-red-600 dark:text-red-400">{state.message}</span>;
  }
  if (state.status === 'scheduled') {
    return <span className="block text-xs text-emerald-700 dark:text-emerald-400">{scheduledText(state.startsNow)}</span>;
  }
  return null;
}

function SmallAction({ label, disabled, onClick }: { label: string; disabled: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="text-xs font-medium text-emerald-700 hover:underline disabled:opacity-50 dark:text-emerald-400"
    >
      {label}
    </button>
  );
}

function renderAudio(video: PageVideo, busy: boolean, onAction: PageVideoListProps['onAction']) {
  if (!video.separateAudio) {
    return null;
  }
  return <SmallAction label="Audio only" disabled={busy} onClick={() => onAction(video, 'audio')} />;
}

export function PageVideoList({ videos, states, onAction }: PageVideoListProps) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
        Videos on this page ({videos.length})
      </h2>
      <ul className="flex flex-col gap-1.5">
        {videos.map((video, index) => {
          const state = stateOf(states, video);
          const busy = state.status === 'starting' || state.status === 'started';
          return (
            <li key={video.url} className="flex items-center gap-2.5 rounded-lg border border-neutral-200 px-3 py-2 dark:border-neutral-700">
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
                {renderNote(state)}
                <span className="mt-0.5 flex gap-3">
                  {renderAudio(video, busy, onAction)}
                  <SmallAction label="Tonight" disabled={busy} onClick={() => onAction(video, 'tonight')} />
                </span>
              </span>
              <button
                type="button"
                disabled={busy}
                onClick={() => onAction(video, 'download')}
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
