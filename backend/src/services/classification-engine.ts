import type { HttpAttempt } from './http-checker.js';
import type { OoniSummary } from './ooni-service.js';
import type { ProbeMeasurement } from './network-probe.js';

export type AccessStatus = 'accessible' | 'blocked' | 'possibly_blocked' | 'unknown' | 'server_error';

export type EvidenceSource = 'probe' | 'control' | 'ooni';

export interface Evidence {
  type: string;
  source: EvidenceSource;
  data: Record<string, unknown>;
}

export interface Classification {
  status: AccessStatus;
  confidence: number;
  evidence: Evidence[];
}

interface Signals {
  reached: HttpAttempt | null;
  blockpage: boolean;
  domainMissing: boolean;
  dnsInterference: boolean;
  httpsReset: boolean;
  ooniConfirmed: boolean;
  ooniRecentCount: number;
  ooniAnomalyRate: number;
}

type Verdict = Pick<Classification, 'status' | 'confidence'>;

const MIN_OONI_SAMPLE = 3;
const STRONG_OONI_SAMPLE = 5;

function attempts(m: ProbeMeasurement): HttpAttempt[] {
  return m.http ? [m.https, m.http] : [m.https];
}

function readSignals(m: ProbeMeasurement, ooni: OoniSummary | null): Signals {
  const all = attempts(m);
  const recent = ooni?.recent;
  return {
    reached: all.find((attempt) => attempt.status !== null && !attempt.blockpage) ?? null,
    blockpage: all.some((attempt) => attempt.blockpage),
    domainMissing: m.dns.error === 'nxdomain' && (m.dns.control === null || m.dns.control.nxdomain),
    dnsInterference: m.dns.manipulated || m.dns.bogon,
    httpsReset: m.https.error === 'reset',
    ooniConfirmed: (recent?.confirmed ?? 0) > 0,
    ooniRecentCount: recent?.measurements ?? 0,
    ooniAnomalyRate: recent && recent.measurements > 0 ? recent.anomalies / recent.measurements : 0,
  };
}

function judgeReachable(attempt: HttpAttempt, s: Signals): Verdict {
  const status = attempt.status as number;
  if (status >= 500) {
    return { status: 'server_error', confidence: 0.85 };
  }
  if (status === 451) {
    return { status: 'possibly_blocked', confidence: 0.6 };
  }
  if (attempt.scheme === 'http' && s.httpsReset) {
    return { status: 'possibly_blocked', confidence: 0.55 };
  }
  if (s.ooniConfirmed) {
    return { status: 'accessible', confidence: 0.7 };
  }
  return { status: 'accessible', confidence: status < 400 ? 0.9 : 0.75 };
}

function judgeUnreachable(s: Signals): Verdict {
  const interference = s.dnsInterference || s.httpsReset;
  const ooniMostlyAnomalous = s.ooniRecentCount >= MIN_OONI_SAMPLE && s.ooniAnomalyRate >= 0.5;
  const ooniStronglyAnomalous = s.ooniRecentCount >= STRONG_OONI_SAMPLE && s.ooniAnomalyRate >= 0.7;
  if (s.domainMissing) {
    return { status: 'unknown', confidence: 0.6 };
  }
  if (s.ooniConfirmed) {
    return { status: 'blocked', confidence: interference ? 0.9 : 0.8 };
  }
  if (interference && ooniStronglyAnomalous) {
    return { status: 'blocked', confidence: 0.8 };
  }
  if (interference) {
    return { status: 'possibly_blocked', confidence: 0.6 };
  }
  if (ooniMostlyAnomalous) {
    return { status: 'possibly_blocked', confidence: 0.5 };
  }
  return { status: 'unknown', confidence: 0.3 };
}

function decide(s: Signals): Verdict {
  if (s.blockpage) {
    return { status: 'blocked', confidence: s.ooniConfirmed ? 0.98 : 0.95 };
  }
  if (s.reached) {
    return judgeReachable(s.reached, s);
  }
  return judgeUnreachable(s);
}

function dnsEvidence(m: ProbeMeasurement): Evidence[] {
  const { dns } = m;
  const data = { host: dns.host, resolvers: dns.resolvers, a: dns.a, aaaa: dns.aaaa, cname: dns.cname };
  const list: Evidence[] = [
    { type: dns.error ? `dns_${dns.error}` : 'dns_resolved', source: 'probe', data: { ...data, error: dns.error } },
  ];
  if (dns.bogon) {
    list.push({ type: 'dns_private_answer', source: 'probe', data });
  }
  if (dns.control) {
    list.push({
      type: dns.control.nxdomain ? 'control_dns_nxdomain' : 'control_dns_resolved',
      source: 'control',
      data: { ...dns.control },
    });
  }
  if (dns.manipulated) {
    list.push({ type: 'dns_control_mismatch', source: 'probe', data: { control: dns.control } });
  }
  return list;
}

function httpEvidence(attempt: HttpAttempt): Evidence[] {
  const data = { ...attempt };
  if (attempt.blockpage) {
    return [{ type: 'blockpage_detected', source: 'probe', data }];
  }
  if (attempt.error) {
    return [{ type: `${attempt.scheme}_${attempt.error}`, source: 'probe', data }];
  }
  return [
    { type: `${attempt.scheme}_connection_success`, source: 'probe', data },
    { type: `${attempt.scheme}_status_${attempt.status}`, source: 'probe', data },
  ];
}

function ooniEvidence(ooni: OoniSummary | null): Evidence[] {
  if (!ooni) {
    return [{ type: 'ooni_unavailable', source: 'ooni', data: {} }];
  }
  const data = { ...ooni };
  if (ooni.recent.measurements === 0) {
    return [{ type: 'ooni_no_recent_data', source: 'ooni', data }];
  }
  if (ooni.recent.confirmed > 0) {
    return [{ type: 'ooni_recent_confirmed', source: 'ooni', data }];
  }
  if (ooni.recent.anomalies > 0) {
    return [{ type: 'ooni_recent_anomalies', source: 'ooni', data }];
  }
  return [{ type: 'ooni_recent_ok', source: 'ooni', data }];
}

export function classify(measurement: ProbeMeasurement, ooni: OoniSummary | null): Classification {
  const verdict = decide(readSignals(measurement, ooni));
  const evidence = [
    ...dnsEvidence(measurement),
    ...attempts(measurement).flatMap(httpEvidence),
    ...ooniEvidence(ooni),
  ];
  return { ...verdict, evidence };
}

interface OoniRates {
  valid: number;
  confirmedRate: number;
  problemRate: number;
}

function ooniRates(ooni: OoniSummary | null): OoniRates {
  if (!ooni) {
    return { valid: 0, confirmedRate: 0, problemRate: 0 };
  }
  const { recent } = ooni;
  const valid = Math.max(recent.measurements - recent.failures, 0);
  if (valid === 0) {
    return { valid, confirmedRate: 0, problemRate: 0 };
  }
  return { valid, confirmedRate: recent.confirmed / valid, problemRate: (recent.confirmed + recent.anomalies) / valid };
}

function sampleConfidence(valid: number, strong: number, weak: number): number {
  if (valid >= STRONG_OONI_SAMPLE) {
    return strong;
  }
  return weak;
}

function ooniOnlyVerdict(rates: OoniRates): Verdict {
  const { valid, confirmedRate, problemRate } = rates;
  if (valid === 0) {
    return { status: 'unknown', confidence: 0.2 };
  }
  if (confirmedRate >= 0.5) {
    return { status: 'blocked', confidence: sampleConfidence(valid, 0.9, 0.7) };
  }
  if (problemRate >= 0.7 && valid >= STRONG_OONI_SAMPLE) {
    return confirmedRate > 0 ? { status: 'blocked', confidence: 0.75 } : { status: 'possibly_blocked', confidence: 0.6 };
  }
  if (problemRate >= 0.2) {
    return { status: 'possibly_blocked', confidence: sampleConfidence(valid, 0.55, 0.4) };
  }
  return { status: 'accessible', confidence: sampleConfidence(valid, 0.75, 0.55) };
}

function ooniOnlyEvidence(ooni: OoniSummary | null, rates: OoniRates): Evidence[] {
  if (!ooni || rates.valid === 0 || rates.problemRate >= 0.2) {
    return ooniEvidence(ooni);
  }
  if (ooni.recent.confirmed > 0) {
    return [{ type: 'ooni_blocked_on_few_networks', source: 'ooni', data: { ...rates } }];
  }
  return [{ type: 'ooni_recent_ok', source: 'ooni', data: { ...rates } }];
}

export function classifyFromOoni(ooni: OoniSummary | null): Classification {
  const rates = ooniRates(ooni);
  const evidence: Evidence[] = [{ type: 'ooni_only', source: 'ooni', data: {} }, ...ooniOnlyEvidence(ooni, rates)];
  return { ...ooniOnlyVerdict(rates), evidence };
}

const TTL_SECONDS: Record<AccessStatus, number> = {
  accessible: 20 * 60,
  blocked: 15 * 60,
  possibly_blocked: 15 * 60,
  server_error: 10 * 60,
  unknown: 5 * 60,
};

export function ttlFor(status: AccessStatus): number {
  return TTL_SECONDS[status];
}
