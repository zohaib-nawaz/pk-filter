interface StatusBadgeProps {
  label: string;
  color: string;
  size?: 'sm' | 'md';
}

const SIZES = {
  sm: 'gap-1.5 px-2 py-0.5 text-xs',
  md: 'gap-2 px-3 py-1 text-sm',
};

export function StatusBadge({ label, color, size = 'sm' }: StatusBadgeProps) {
  return (
    <span className={`inline-flex flex-none items-center rounded-full border border-neutral-200 bg-white font-medium text-neutral-800 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 ${SIZES[size]}`}>
      <span className="h-2 w-2 rounded-full" style={{ background: color }} aria-hidden />
      {label}
    </span>
  );
}
