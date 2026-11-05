import { alternativesFor, needsAlternatives, type AlternativeLink } from '@shared/alternatives';
import { countryName } from '@shared/countries';
import { describeEvidence } from '@shared/evidence';
import { formatConfidence, formatNetwork, formatRelative } from '@shared/format';
import { networksOf } from '@shared/networks';
import { STATUS_META } from '@shared/status-meta';
import type { CountrySource, MeasuredBy } from '@shared/types';
import type { SiteCheck } from './check-api';

export interface Chip {
  label: string;
  color: string;
}

export interface CheckFact {
  label: string;
  value: string;
}

export interface CheckView {
  domain: string;
  headline: string;
  status: Chip;
  description: string;
  facts: CheckFact[];
  networks: Array<Chip & { isp: string }>;
  evidence: string[];
  links: AlternativeLink[];
}

const MEASURED_BY: Record<MeasuredBy, string> = {
  probe: 'Live test from a server in this country, cross-checked with OONI',
  peer: 'Live test from a server in this country, cross-checked with OONI',
  ooni: 'OONI volunteer reports from this country',
};

const SOURCE: Record<CountrySource, string> = {
  chosen: 'chosen by you',
  ip: 'from your IP address',
  default: 'default',
};

export function checkView(check: SiteCheck, now: number = Date.now()): CheckView | null {
  const { result } = check;
  if (!result) {
    return null;
  }
  const meta = STATUS_META[result.status];
  const country = countryName(check.country);
  return {
    domain: check.domain,
    headline: `${check.domain} in ${country}`,
    status: { label: meta.label, color: meta.color },
    description: meta.description,
    facts: [
      { label: 'Country', value: `${country} (${SOURCE[check.countrySource]})` },
      { label: 'Measured by', value: MEASURED_BY[check.measuredBy] },
      { label: 'Network', value: formatNetwork(result.network) },
      { label: 'Confidence', value: formatConfidence(result.confidence) },
      { label: 'Checked', value: formatRelative(result.lastChecked, now) },
    ],
    networks: networksOf(result).map((network) => ({ isp: network.isp, label: STATUS_META[network.status].label, color: STATUS_META[network.status].color })),
    evidence: describeEvidence(result.evidence, 5),
    links: needsAlternatives(result.status) ? alternativesFor(check.domain, check.country) : [],
  };
}
