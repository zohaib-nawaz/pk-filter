interface FrameProgressProps {
  done: number;
  total: number;
  onCancel: () => void;
}

export function FrameProgress({ done, total, onCancel }: FrameProgressProps) {
  const percent = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-neutral-200 p-5 dark:border-neutral-800">
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="font-semibold">
          Saving frame {done} of {total}
        </span>
        <button type="button" onClick={onCancel} className="rounded-lg px-3 py-1.5 font-medium text-red-700 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-950/40">
          Stop
        </button>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
        <div className="h-full rounded-full bg-emerald-600 transition-[width]" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}
