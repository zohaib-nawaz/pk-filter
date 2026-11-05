import type { AccessStatus } from './classification-engine.js';

export interface NetworkResult {
  isp: string;
  asn: string;
  city: string;
  status: AccessStatus;
  confidence: number;
  lastChecked: string;
  evidence: string[];
}

export interface Aggregate {
  status: AccessStatus;
  confidence: number;
  evidence: string[];
}

const HISTORY_SEVERITY: Record<AccessStatus, number> = {
  blocked: 4,
  possibly_blocked: 3,
  server_error: 2,
  accessible: 1,
  unknown: 0,
};

export function severity(status: AccessStatus): number {
  return HISTORY_SEVERITY[status];
}

export function aggregateNetworks(results: NetworkResult[]): Aggregate {
  const [only] = results;
  if (results.length === 1 && only) {
    return { status: only.status, confidence: only.confidence, evidence: only.evidence };
  }
  const measured = results.filter((result) => result.status !== 'unknown');
  const evidence = [...new Set(results.flatMap((result) => result.evidence))];
  if (measured.length === 0) {
    return { status: 'unknown', confidence: 0.3, evidence };
  }
  const blocked = measured.filter((result) => result.status === 'blocked');
  const suspicious = measured.filter((result) => result.status === 'possibly_blocked');
  if (blocked.length === measured.length) {
    return { status: 'blocked', confidence: Math.min(...blocked.map((result) => result.confidence)), evidence };
  }
  if (blocked.length + suspicious.length > 0) {
    const note = blocked.length > 0 ? 'blocked_on_some_networks' : 'suspicious_on_some_networks';
    return { status: 'possibly_blocked', confidence: 0.6, evidence: [note, ...evidence] };
  }
  const accessible = measured.filter((result) => result.status === 'accessible');
  if (accessible.length > 0) {
    return { status: 'accessible', confidence: Math.max(...accessible.map((result) => result.confidence)), evidence };
  }
  return { status: 'server_error', confidence: Math.max(...measured.map((result) => result.confidence)), evidence };
}
