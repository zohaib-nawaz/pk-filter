import { useState, type ChangeEvent, type DragEvent } from 'react';
import { LinkForm } from '../LinkForm';

interface FrameSourcePickerProps {
  onFile: (file: File) => void;
  onLink: (link: string) => void;
}

const ZONE = 'flex cursor-pointer flex-col items-center gap-2 rounded-2xl border-2 border-dashed px-6 py-10 text-center transition-colors';
const ZONE_IDLE = 'border-neutral-300 hover:border-emerald-500 dark:border-neutral-700';
const ZONE_ACTIVE = 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/30';

export function FrameSourcePicker({ onFile, onLink }: FrameSourcePickerProps) {
  const [dragging, setDragging] = useState(false);

  const pick = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.item(0);
    if (file) {
      onFile(file);
    }
    event.target.value = '';
  };

  const drop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setDragging(false);
    const [file] = event.dataTransfer.files;
    if (file) {
      onFile(file);
    }
  };

  const zone = `${ZONE} ${dragging ? ZONE_ACTIVE : ZONE_IDLE}`;

  return (
    <div className="flex flex-col gap-5">
      <label
        className={zone}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={drop}
      >
        <svg viewBox="0 0 24 24" className="h-10 w-10 text-emerald-600" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <path d="M3 9h18M8 5v4M16 5v4M8 15v4M16 15v4M3 15h18" />
        </svg>
        <span className="font-semibold">Choose a video file or drop it here</span>
        <span className="text-sm text-neutral-500 dark:text-neutral-400">MP4, WebM or MOV. The file stays on your device.</span>
        <input type="file" accept="video/*,.mkv,.mov,.m4v" className="sr-only" onChange={pick} />
      </label>
      <div className="flex items-center gap-3 text-xs font-semibold uppercase tracking-wider text-neutral-400">
        <span className="h-px flex-1 bg-neutral-200 dark:bg-neutral-800" />
        or use a link
        <span className="h-px flex-1 bg-neutral-200 dark:bg-neutral-800" />
      </div>
      <LinkForm id="frame-link" label="Video link" placeholder="https://example.com/video.mp4" action="Open video" busy={false} onSubmit={onLink} />
    </div>
  );
}
