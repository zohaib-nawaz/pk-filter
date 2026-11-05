import { countryName } from '../../core/countries';
import { formatNetwork, formatRelative } from '../../core/format';
import type { MeasuredBy, OverviewStats } from '../../core/types';
import { StatRow } from './StatRow';
import { StatusDot } from './StatusDot';

interface ServiceSummaryProps {
  overview: OverviewStats | null;
}

function serviceLabel(online: boolean | null): string {
  if (online === null) {
    return 'Checking…';
  }
  return online ? 'Online' : 'Offline';
}

const MEASURED_BY: Record<MeasuredBy, string> = {
  probe: 'test server',
  peer: 'test server',
  ooni: 'OONI reports',
};

function checkingFor(overview: OverviewStats | null): string {
  if (!overview || !overview.viewer) {
    return '-';
  }
  return `${countryName(overview.viewer.country)} · ${MEASURED_BY[overview.viewer.measuredBy]}`;
}

function networkSummary(overview: OverviewStats | null): { label: string; value: string } {
  if (!overview) {
    return { label: 'Test network', value: formatNetwork(null) };
  }
  const { networks, network } = overview.service;
  if (networks.length > 1) {
    return { label: 'Test networks', value: networks.map((item) => item.isp).join(' · ') };
  }
  return { label: 'Test network', value: formatNetwork(network) };
}

export function ServiceSummary({ overview }: ServiceSummaryProps) {
  const online = overview ? overview.service.online : null;
  const networks = networkSummary(overview);
  const ooni = overview?.service.ooni ? 'Enabled' : 'Off';
  const cached = overview ? overview.cachedDomains : '-';
  const lastSync = formatRelative(overview ? overview.sync.lastSync : null);
  return (
    <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
      <StatRow
        label="Checking service"
        value={
          <span className="inline-flex items-center gap-1.5">
            <StatusDot online={online} />
            {serviceLabel(online)}
          </span>
        }
      />
      <StatRow label="Checking for" value={checkingFor(overview)} />
      <StatRow label={networks.label} value={networks.value} />
      <StatRow label="OONI data" value={ooni} />
      <StatRow label="Cached domains" value={cached} />
      <StatRow label="Last sync" value={lastSync} />
    </div>
  );
}
