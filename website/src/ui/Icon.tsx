import type { IconName } from '../core/content';

const PATHS: Record<IconName, string[]> = {
  badge: ['M4 7h16v10H4z', 'M8 12h.01', 'M11 12h6'],
  filter: ['M4 5h16l-6 7v6l-4 2v-8z'],
  globe: ['M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18z', 'M3 12h18', 'M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9s1.3-6.4 3.8-9z'],
  network: ['M5 19a2 2 0 1 0 0-4a2 2 0 0 0 0 4z', 'M19 19a2 2 0 1 0 0-4a2 2 0 0 0 0 4z', 'M12 7a2 2 0 1 0 0-4a2 2 0 0 0 0 4z', 'M12 7v4', 'M5 15l7-4l7 4'],
  alert: ['M12 3l9 16H3z', 'M12 10v4', 'M12 17h.01'],
  cursor: ['M5 3l14 7l-6 2l-2 6z'],
  download: ['M12 4v11', 'M7 10l5 5l5-5', 'M5 20h14'],
  moon: ['M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z'],
};

export function Icon({ name, className = 'h-5 w-5' }: { name: IconName; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      {PATHS[name].map((path) => (
        <path key={path} d={path} />
      ))}
    </svg>
  );
}

export function Logo({ className = 'h-8 w-8' }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <circle cx="16" cy="16" r="15" fill="#188038" />
      <path d="M9.5 16.5l4.5 4.5l8.5-9" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
