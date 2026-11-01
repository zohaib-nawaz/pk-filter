const LABELS: Record<string, string> = {
  dns_resolved: 'DNS resolved',
  dns_nxdomain: 'Domain does not resolve',
  dns_timeout: 'DNS timed out',
  dns_private_answer: 'DNS returned a private address',
  dns_control_mismatch: 'DNS differs from an independent resolver',
  control_dns_nxdomain: 'Independent resolver: domain missing',
  https_connection_success: 'HTTPS connection succeeded',
  http_connection_success: 'HTTP connection succeeded',
  https_reset: 'HTTPS connection was reset',
  https_timeout: 'HTTPS timed out',
  https_tls: 'TLS certificate problem',
  blockpage_detected: 'Pakistani block page detected',
  ooni_recent_confirmed: 'OONI: confirmed blocking this week',
  ooni_recent_anomalies: 'OONI: anomalies this week',
  ooni_recent_ok: 'OONI: recent measurements OK',
  ooni_no_recent_data: 'OONI: no recent data',
  service_unavailable: 'Checking service unreachable',
  probe_error: 'Measurement failed',
};

const SKIPPED = new Set(['control_dns_resolved', 'ooni_unavailable']);

export function describeEvidence(codes: string[], limit = 4): string[] {
  return codes
    .filter((code) => !SKIPPED.has(code))
    .map((code) => LABELS[code] ?? code.replace(/_/g, ' '))
    .slice(0, limit);
}
