import type { DownloadView } from '../../core/types';
import { Button } from './Button';
import { DownloadItem, type DownloadHandlers } from './DownloadItem';

interface DownloadListProps extends DownloadHandlers {
  items: DownloadView[];
  enabled: boolean;
  message: string | null;
  onOpenSettings: () => void;
}

export function DownloadList({ items, enabled, message, onOpenSettings, ...handlers }: DownloadListProps) {
  if (!enabled) {
    return (
      <div className="flex flex-col items-start gap-3 rounded-lg bg-neutral-50 p-4 dark:bg-neutral-800">
        <p className="text-sm">The video downloader is off.</p>
        <p className="text-xs text-neutral-500 dark:text-neutral-400">
          Turn it on in Settings to see download icons on Google results and video pages.
        </p>
        <Button variant="primary" onClick={onOpenSettings}>
          Open settings
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {message && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950/40 dark:text-red-300">{message}</p>
      )}
      {items.length === 0 ? (
        <p className="py-6 text-center text-sm text-neutral-500 dark:text-neutral-400">
          No downloads yet. Look for the download icon on video pages.
        </p>
      ) : (
        <ul className="max-h-80 divide-y divide-neutral-100 overflow-y-auto dark:divide-neutral-800">
          {items.map((view) => (
            <DownloadItem key={view.streamId ?? view.record.id} view={view} {...handlers} />
          ))}
        </ul>
      )}
    </div>
  );
}
