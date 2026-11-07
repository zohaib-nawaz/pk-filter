import type { ReactNode } from 'react';
import { WarningNote } from '../Notice';
import { BUTTON, BUTTON_QUIET } from '../styles';

export interface GalleryFrame {
  name: string;
  url: string;
  time: string;
}

interface FrameGalleryProps {
  frames: GalleryFrame[];
  summary: string;
  note: string | null;
  zipping: boolean;
  onDownloadAll: () => void;
  onBack: () => void;
  children?: ReactNode;
}

function renderNote(note: string | null) {
  if (!note) {
    return null;
  }
  return <WarningNote message={note} />;
}

export function FrameGallery({ frames, summary, note, zipping, onDownloadAll, onBack, children }: FrameGalleryProps) {
  return (
    <section className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">Your frames</h2>
          <p className="text-sm text-neutral-500 dark:text-neutral-400">{summary}</p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={onBack} className={BUTTON_QUIET}>
            Change settings
          </button>
          <button type="button" onClick={onDownloadAll} disabled={zipping || frames.length === 0} className={BUTTON}>
            Download all (ZIP)
          </button>
        </div>
      </header>
      {renderNote(note)}
      <details className="rounded-xl border border-neutral-200 px-4 py-3 dark:border-neutral-800">
        <summary className="cursor-pointer text-sm font-medium">Rename files</summary>
        <div className="mt-3">{children}</div>
      </details>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {frames.map((frame) => (
          <li key={frame.url} className="overflow-hidden rounded-xl border border-neutral-200 dark:border-neutral-800">
            <a href={frame.url} download={frame.name} className="group block" aria-label={`Download frame at ${frame.time}`}>
              <img src={frame.url} alt={`Frame at ${frame.time}`} loading="lazy" className="aspect-video w-full bg-black object-contain" />
              <span className="flex items-center justify-between gap-2 px-2.5 py-1.5 text-xs tabular-nums">
                <span className="min-w-0 truncate" title={frame.name}>
                  {frame.name}
                </span>
                <span className="font-semibold text-emerald-700 group-hover:underline dark:text-emerald-400">Save</span>
              </span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
