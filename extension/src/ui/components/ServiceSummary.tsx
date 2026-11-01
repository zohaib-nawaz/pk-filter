import { formatNetwork, formatRelative } from '../../core/format';
import type { OverviewStats } from '../../core/types';
import { StatRow } from './StatRow';
import { StatusDot } from './StatusDot';

interface ServiceSummaryProps {
  overview: OverviewStats | null;
}

export function ServiceSummary({ overview }: ServiceSummaryProps) {
  const online = overview ? overview.service.online : null;
  const serviceLabel = online === null ? 'Checking…' : online ? 'Online' : 'Offline';
  return (
    <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
      <StatRow
        label="Checking service"
        value={
          <span className="inline-flex items-center gap-1.5">
            <StatusDot online={online} />
            {serviceLabel}
          </span>
        }
      />
      <StatRow label="Test network" value={formatNetwork(overview?.service.network ?? null)} />
      <StatRow label="OONI data" value={overview?.service.ooni ? 'Enabled' : 'Off'} />
      <StatRow label="Cached domains" value={overview?.cachedDomains ?? '-'} />
      <StatRow label="Last sync" value={formatRelative(overview?.sync.lastSync ?? null)} />
    </div>
  );
}
