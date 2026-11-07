import { useRef } from 'react';
import { BUTTON_QUIET_SMALL } from '../styles';

interface FramePlayerProps {
  src: string;
  crossOrigin: boolean;
  title: string;
  detail: string;
  onPick: (edge: 'start' | 'end', time: number) => void;
}

export function FramePlayer({ src, crossOrigin, title, detail, onPick }: FramePlayerProps) {
  const player = useRef<HTMLVideoElement>(null);
  const current = () => player.current?.currentTime ?? 0;
  const cors = crossOrigin ? 'anonymous' : undefined;

  return (
    <div className="flex flex-col gap-3">
      <video ref={player} src={src} crossOrigin={cors} controls muted playsInline preload="metadata" className="aspect-video w-full rounded-xl bg-black" />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-semibold" title={title}>
            {title}
          </p>
          <p className="text-sm text-neutral-500 dark:text-neutral-400">{detail}</p>
        </div>
        <div className="flex gap-2">
          <button type="button" className={BUTTON_QUIET_SMALL} onClick={() => onPick('start', current())}>
            Start here
          </button>
          <button type="button" className={BUTTON_QUIET_SMALL} onClick={() => onPick('end', current())}>
            End here
          </button>
        </div>
      </div>
    </div>
  );
}
