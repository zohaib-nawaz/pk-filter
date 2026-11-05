function numberFrom(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return value && Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function listFrom(value: string | undefined): string[] {
  return (value ?? '').split(',').map((item) => item.trim()).filter(Boolean);
}

export interface PeerProbe {
  country: string | null;
  url: string;
}

function peerFrom(entry: string): PeerProbe {
  const match = /^([A-Za-z]{2})=(.+)$/.exec(entry);
  if (!match) {
    return { country: null, url: entry };
  }
  return { country: (match[1] as string).toUpperCase(), url: match[2] as string };
}

export const config = {
  port: numberFrom(process.env.PORT, 8787),
  host: process.env.HOST ?? '0.0.0.0',
  trustProxy: process.env.TRUST_PROXY === 'true',
  logLevel: process.env.LOG_LEVEL ?? 'info',
  network: {
    country: (process.env.PROBE_COUNTRY ?? 'PK').toUpperCase(),
    isp: process.env.PROBE_ISP ?? 'unknown',
    asn: process.env.PROBE_ASN ?? 'unknown',
    city: process.env.PROBE_CITY ?? 'unknown',
  },
  dnsServers: listFrom(process.env.DNS_SERVERS),
  controlDohUrl: process.env.CONTROL_DOH_URL ?? 'https://cloudflare-dns.com/dns-query',
  ooniEnabled: process.env.OONI_ENABLED !== 'false',
  ooniBaseUrl: process.env.OONI_BASE_URL ?? 'https://api.ooni.io',
  checkConcurrency: numberFrom(process.env.CHECK_CONCURRENCY, 6),
  rateLimitPerMinute: numberFrom(process.env.RATE_LIMIT_PER_MINUTE, 60),
  retentionDays: numberFrom(process.env.RETENTION_DAYS, 30),
  databaseUrl: process.env.DATABASE_URL ?? '',
  peerProbes: listFrom(process.env.PEER_PROBES).map(peerFrom),
  geoipDb: process.env.GEOIP_DB ?? '',
  corsOrigins: listFrom(process.env.CORS_ORIGINS ?? 'http://localhost:3180'),
  probeToken: process.env.PROBE_TOKEN ?? '',
  maxDomainsPerRequest: 20,
} as const;

export type ProbeNetwork = typeof config.network;
