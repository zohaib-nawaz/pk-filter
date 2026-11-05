import type { CheckResult, LocalProbe } from './types';

const OPENS = 'opens_on_your_connection';
const FAILS = 'fails_on_your_connection';

function withEvidence(result: CheckResult, code: string): string[] {
  return [code, ...result.evidence.filter((item) => item !== OPENS && item !== FAILS)];
}

export function mergeLocalCheck(result: CheckResult, probe: LocalProbe): CheckResult {
  if (probe === 'reachable') {
    if (result.status === 'server_error') {
      return { ...result, localCheck: probe, evidence: withEvidence(result, OPENS) };
    }
    return { ...result, status: 'accessible', confidence: Math.max(result.confidence, 0.8), localCheck: probe, evidence: withEvidence(result, OPENS) };
  }
  if (result.status === 'blocked') {
    return { ...result, confidence: Math.max(result.confidence, 0.9), localCheck: probe, evidence: withEvidence(result, FAILS) };
  }
  return { ...result, status: 'possibly_blocked', confidence: 0.5, localCheck: probe, evidence: withEvidence(result, FAILS) };
}
