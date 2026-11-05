import { Resolver } from 'node:dns/promises';
import { config } from '../config.js';
import { isPublicIp } from '../utils/ip.js';

export type DnsError = 'nxdomain' | 'no_data' | 'timeout' | 'servfail' | 'refused' | 'other';

export interface ControlDns {
  resolver: string;
  nxdomain: boolean;
  addresses: string[];
}

export interface DnsResult {
  host: string;
  resolvers: string[];
  a: string[];
  aaaa: string[];
  cname: string[];
  error: DnsError | null;
  bogon: boolean;
  control: ControlDns | null;
  manipulated: boolean;
}

interface Settled<T> {
  values: T[];
  error: DnsError | null;
}

const resolver = new Resolver({ timeout: 3000, tries: 2 });
if (config.dnsServers.length > 0) {
  resolver.setServers(config.dnsServers);
}

const ERROR_CODES: Record<string, DnsError> = {
  ENOTFOUND: 'nxdomain',
  ENODATA: 'no_data',
  ETIMEOUT: 'timeout',
  ESERVFAIL: 'servfail',
  EREFUSED: 'refused',
};

async function settle<T>(task: Promise<T[]>): Promise<Settled<T>> {
  try {
    return { values: await task, error: null };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? '';
    return { values: [], error: ERROR_CODES[code] ?? 'other' };
  }
}

export async function resolveAddresses(host: string): Promise<string[]> {
  const [v4, v6] = await Promise.all([settle(resolver.resolve4(host)), settle(resolver.resolve6(host))]);
  return [...v4.values, ...v6.values];
}

async function queryControl(host: string): Promise<ControlDns | null> {
  try {
    const url = new URL(config.controlDohUrl);
    url.searchParams.set('name', host);
    url.searchParams.set('type', 'A');
    const response = await fetch(url, {
      headers: { accept: 'application/dns-json' },
      signal: AbortSignal.timeout(4000),
    });
    if (!response.ok) {
      return null;
    }
    const body = (await response.json()) as { Status?: number; Answer?: Array<{ type: number; data: string }> };
    const answers = Array.isArray(body.Answer) ? body.Answer : [];
    const addresses = answers.filter((answer) => answer.type === 1).map((answer) => answer.data);
    return { resolver: url.hostname, nxdomain: body.Status === 3, addresses };
  } catch {
    return null;
  }
}

export async function checkDns(host: string): Promise<DnsResult> {
  const [v4, v6, cname, control] = await Promise.all([
    settle(resolver.resolve4(host)),
    settle(resolver.resolve6(host)),
    settle(resolver.resolveCname(host)),
    queryControl(host),
  ]);
  const addresses = [...v4.values, ...v6.values];
  const error = addresses.length > 0 ? null : (v4.error ?? v6.error ?? 'no_data');
  const bogon = addresses.some((address) => !isPublicIp(address));
  const controlResolvesPublic = control?.addresses.some(isPublicIp) ?? false;
  return {
    host,
    resolvers: resolver.getServers(),
    a: v4.values,
    aaaa: v6.values,
    cname: cname.values,
    error,
    bogon,
    control,
    manipulated: controlResolvesPublic && (error !== null || bogon),
  };
}
