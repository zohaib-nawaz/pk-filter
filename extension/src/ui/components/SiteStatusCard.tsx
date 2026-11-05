import type { HistoryCell, NetworkChip, SiteCardView } from '../../core/site-view';
import type { AlternativeLink } from '../../core/alternatives';
import type { SiteCardState } from '../hooks/useSiteStatus';

interface SiteStatusCardProps {
  state: SiteCardState;
}

const SHELL = 'rounded-lg border border-neutral-200 px-3 py-2.5 dark:border-neutral-700';

function Dot({ color }: { color: string }) {
  return <span className="inline-block h-2 w-2 flex-none rounded-full" style={{ background: color }} aria-hidden />;
}

function formatDay(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

function renderNetworks(networks: NetworkChip[]) {
  if (networks.length === 0) {
    return null;
  }
  return (
    <ul className="flex flex-wrap gap-x-3 gap-y-1">
      {networks.map((network) => (
        <li key={network.isp} className="flex items-center gap-1 text-xs">
          <Dot color={network.color} />
          <span className="font-medium">{network.isp}</span>
          <span className="text-neutral-500 dark:text-neutral-400">{network.label}</span>
        </li>
      ))}
    </ul>
  );
}

function renderBlockedSince(blockedSince: string | null) {
  if (!blockedSince) {
    return null;
  }
  return <span className="font-medium text-red-600 dark:text-red-400">Blocked since {formatDay(blockedSince)}</span>;
}

function renderHistory(history: HistoryCell[] | null, blockedSince: string | null) {
  if (!history) {
    return null;
  }
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between text-[11px] text-neutral-500 dark:text-neutral-400">
        <span>Last 30 days</span>
        {renderBlockedSince(blockedSince)}
      </div>
      <div className="flex gap-[2px]">
        {history.map((cell) => (
          <span key={cell.day} title={cell.title} className="h-3 flex-1 rounded-[2px]" style={{ background: cell.color }} />
        ))}
      </div>
    </div>
  );
}

function renderAlternatives(links: AlternativeLink[]) {
  if (links.length === 0) {
    return null;
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {links.map((link) => (
        <a
          key={link.url}
          href={link.url}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-md border border-neutral-200 px-2 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-50 dark:border-neutral-700 dark:text-emerald-400 dark:hover:bg-emerald-950/40"
        >
          {link.label}
        </a>
      ))}
    </div>
  );
}

function renderReady(view: SiteCardView) {
  return (
    <section className={`${SHELL} flex flex-col gap-2`} aria-label="This site">
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate text-sm font-semibold" title={view.domain}>
          {view.domain}
        </span>
        <span className="flex flex-none items-center gap-1.5 text-xs font-medium">
          <Dot color={view.status.color} />
          {view.status.label}
        </span>
      </div>
      <p className="text-xs text-neutral-500 dark:text-neutral-400">{view.checked}</p>
      {renderNetworks(view.networks)}
      {renderHistory(view.history, view.blockedSince)}
      {renderAlternatives(view.alternatives)}
    </section>
  );
}

export function SiteStatusCard({ state }: SiteStatusCardProps) {
  if (state.phase === 'loading') {
    return <div className={`${SHELL} h-16 animate-pulse bg-neutral-50 dark:bg-neutral-800`} />;
  }
  if (state.phase === 'unsupported') {
    return <p className={`${SHELL} text-xs text-neutral-500 dark:text-neutral-400`}>Open a website to see if it works from Pakistan.</p>;
  }
  if (state.phase === 'unavailable') {
    return (
      <p className={`${SHELL} text-xs text-neutral-500 dark:text-neutral-400`}>
        Could not check <span className="font-medium text-neutral-700 dark:text-neutral-200">{state.domain}</span> right now.
      </p>
    );
  }
  return renderReady(state.view);
}
