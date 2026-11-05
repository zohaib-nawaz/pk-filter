import type { CheckResult, NetworkResult } from './types';

export const ALL_NETWORKS = '';

export function networksOf(result: CheckResult): NetworkResult[] {
  if (!result.networks) {
    return [];
  }
  return result.networks;
}

export function effectiveResult(result: CheckResult, preferredIsp: string): CheckResult {
  if (preferredIsp === ALL_NETWORKS) {
    return result;
  }
  const chosen = networksOf(result).find((network) => network.isp === preferredIsp);
  if (!chosen) {
    return result;
  }
  return {
    ...result,
    status: chosen.status,
    confidence: chosen.confidence,
    evidence: chosen.evidence,
    lastChecked: chosen.lastChecked,
    network: { isp: chosen.isp, asn: chosen.asn, city: chosen.city },
  };
}

export function isSplitDecision(result: CheckResult): boolean {
  return result.evidence.includes('blocked_on_some_networks');
}
