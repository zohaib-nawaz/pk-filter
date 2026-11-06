import type { ProbeNetwork } from '../config.js';
import { checkDns, type DnsResult } from './dns-checker.js';
import { checkHttp, type HttpAttempt } from './http-checker.js';

export interface ProbeMeasurement {
  domain: string;
  host: string;
  dns: DnsResult;
  https: HttpAttempt;
  http: HttpAttempt | null;
  network: ProbeNetwork;
  measuredAt: string;
}

export type Probe = (domain: string) => Promise<ProbeMeasurement>;

const HTTPS_TIMEOUT_MS = 8000;
const HTTP_TIMEOUT_MS = 6000;

async function resolveTarget(domain: string): Promise<DnsResult> {
  const apex = await checkDns(domain);
  if (!apex.error || apex.manipulated) {
    return apex;
  }
  const www = await checkDns(`www.${domain}`);
  return www.error ? apex : www;
}

function reached(attempt: HttpAttempt): boolean {
  return attempt.status !== null && !attempt.blockpage;
}

export function createNetworkProbe(network: ProbeNetwork): Probe {
  return async (domain) => {
    const dns = await resolveTarget(domain);
    const addresses = [...dns.a, ...dns.aaaa];
    const https = await checkHttp(dns.host, 'https', addresses, HTTPS_TIMEOUT_MS);
    const http = reached(https) ? null : await checkHttp(dns.host, 'http', addresses, HTTP_TIMEOUT_MS);
    return { domain, host: dns.host, dns, https, http, network, measuredAt: new Date().toISOString() };
  };
}
