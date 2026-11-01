interface StatusDotProps {
  online: boolean | null;
}

export function StatusDot({ online }: StatusDotProps) {
  const color = online === null ? 'bg-neutral-400' : online ? 'bg-emerald-500' : 'bg-red-500';
  return <span className={`inline-block h-2 w-2 rounded-full ${color}`} aria-hidden />;
}
