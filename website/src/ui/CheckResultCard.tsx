import type { CheckView } from '../core/check-view';
import { StatusBadge } from './StatusBadge';

function renderNetworks(networks: CheckView['networks']) {
  if (networks.length < 2) {
    return null;
  }
  return (
    <div>
      <h4 className="text-xs font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">By network</h4>
      <ul className="mt-2 flex flex-wrap gap-2">
        {networks.map((network) => (
          <li key={network.isp} className="flex items-center gap-2 text-sm">
            <span className="font-medium">{network.isp}</span>
            <StatusBadge label={network.label} color={network.color} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function renderEvidence(evidence: string[]) {
  if (evidence.length === 0) {
    return null;
  }
  return (
    <div>
      <h4 className="text-xs font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">Evidence</h4>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-neutral-700 dark:text-neutral-200">
        {evidence.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

function renderLinks(links: CheckView['links']) {
  if (links.length === 0) {
    return null;
  }
  return (
    <div className="flex flex-wrap gap-2">
      {links.map((link) => (
        <a
          key={link.url}
          href={link.url}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-lg border border-neutral-200 px-3 py-1.5 text-sm font-medium text-emerald-700 hover:bg-emerald-50 dark:border-neutral-700 dark:text-emerald-400 dark:hover:bg-emerald-950/40"
        >
          {link.label}
        </a>
      ))}
    </div>
  );
}

export function CheckResultCard({ view }: { view: CheckView }) {
  return (
    <article className="flex flex-col gap-5 rounded-2xl border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-900" aria-live="polite">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-lg font-semibold break-all">{view.headline}</h3>
        <StatusBadge label={view.status.label} color={view.status.color} size="md" />
      </header>
      <p className="text-sm text-neutral-600 dark:text-neutral-300">{view.description}</p>
      <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
        {view.facts.map((fact) => (
          <div key={fact.label}>
            <dt className="text-neutral-500 dark:text-neutral-400">{fact.label}</dt>
            <dd className="font-medium">{fact.value}</dd>
          </div>
        ))}
      </dl>
      {renderNetworks(view.networks)}
      {renderEvidence(view.evidence)}
      {renderLinks(view.links)}
    </article>
  );
}
