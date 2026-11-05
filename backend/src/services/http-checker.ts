import http from 'node:http';
import https from 'node:https';
import { isIP, type LookupFunction } from 'node:net';
import { isSafeTargetHost } from '../utils/domain.js';
import { isPublicIp, stripBrackets } from '../utils/ip.js';
import { detectBlockpage } from './blockpage.js';
import { resolveAddresses } from './dns-checker.js';

export type HttpScheme = 'https' | 'http';

export type HttpError =
  | 'timeout'
  | 'reset'
  | 'refused'
  | 'unreachable'
  | 'tls'
  | 'dns'
  | 'unsafe_address'
  | 'unsafe_redirect'
  | 'too_many_redirects'
  | 'other';

export interface HttpAttempt {
  scheme: HttpScheme;
  status: number | null;
  finalUrl: string | null;
  redirects: number;
  error: HttpError | null;
  errorCode: string | null;
  blockpage: boolean;
  durationMs: number;
}

interface Hop {
  status: number;
  location: string | null;
  body: string;
}

const MAX_REDIRECTS = 5;
const MAX_ADDRESS_ATTEMPTS = 2;
const RETRY_ON_NEXT_ADDRESS = new Set<HttpError>(['timeout', 'refused', 'unreachable', 'reset']);
const MAX_BODY_BYTES = 64 * 1024;
const HEADERS = {
  'user-agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
  accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
  'accept-language': 'en-US,en;q=0.8',
};

class ProbeFailure extends Error {
  constructor(
    readonly kind: HttpError,
    readonly code: string | null = null,
  ) {
    super(kind);
  }
}

function toFailure(error: unknown): ProbeFailure {
  if (error instanceof ProbeFailure) {
    return error;
  }
  const code = (error as NodeJS.ErrnoException).code ?? (error as Error).name ?? null;
  if (!code) {
    return new ProbeFailure('other');
  }
  if (['ECONNRESET', 'EPIPE', 'ECONNABORTED'].includes(code)) {
    return new ProbeFailure('reset', code);
  }
  if (code === 'ECONNREFUSED') {
    return new ProbeFailure('refused', code);
  }
  if (['ETIMEDOUT', 'ABORT_ERR', 'AbortError', 'TimeoutError'].includes(code)) {
    return new ProbeFailure('timeout', code);
  }
  if (['EHOSTUNREACH', 'ENETUNREACH'].includes(code)) {
    return new ProbeFailure('unreachable', code);
  }
  if (/CERT|SSL|TLS|EPROTO|SELF_SIGNED|UNABLE_TO|DEPTH_ZERO|HOSTNAME/.test(code)) {
    return new ProbeFailure('tls', code);
  }
  return new ProbeFailure('other', code);
}

function pinnedLookup(address: string): LookupFunction {
  const family = isIP(address);
  return ((_hostname: string, options: { all?: boolean }, callback: (...args: unknown[]) => void) => {
    if (options.all) {
      callback(null, [{ address, family }]);
    } else {
      callback(null, address, family);
    }
  }) as unknown as LookupFunction;
}

export function nextRedirect(current: URL, location: string): URL {
  let next: URL;
  try {
    next = new URL(location, current);
  } catch {
    throw new ProbeFailure('unsafe_redirect');
  }
  const allowedPort = next.port === '' || next.port === '80' || next.port === '443';
  const allowedScheme = next.protocol === 'http:' || next.protocol === 'https:';
  if (!allowedScheme || !allowedPort || next.username || next.password || !isSafeTargetHost(next.hostname)) {
    throw new ProbeFailure('unsafe_redirect');
  }
  return next;
}

async function addressesFor(hostname: string, known: string[] | undefined): Promise<string[]> {
  const host = stripBrackets(hostname);
  const addresses = isIP(host) ? [host] : (known ?? (await resolveAddresses(host)));
  if (addresses.length === 0) {
    throw new ProbeFailure('dns');
  }
  if (!addresses.every(isPublicIp)) {
    throw new ProbeFailure('unsafe_address');
  }
  return addresses;
}

function fetchHop(url: URL, address: string, timeoutMs: number): Promise<Hop> {
  const transport = url.protocol === 'https:' ? https : http;
  return new Promise<Hop>((resolve, reject) => {
    const request = transport.request(
      url,
      {
        method: 'GET',
        headers: HEADERS,
        lookup: pinnedLookup(address),
        agent: false,
        timeout: timeoutMs,
        signal: AbortSignal.timeout(timeoutMs),
      },
      (response) => {
        const chunks: Buffer[] = [];
        let size = 0;
        let settled = false;
        const finish = () => {
          if (settled) {
            return;
          }
          settled = true;
          resolve({
            status: response.statusCode ?? 0,
            location: response.headers.location ?? null,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        };
        response.on('data', (chunk: Buffer) => {
          chunks.push(chunk);
          size += chunk.length;
          if (size >= MAX_BODY_BYTES) {
            finish();
            response.destroy();
          }
        });
        response.on('end', finish);
        response.on('error', (error) => (settled ? undefined : reject(error)));
      },
    );
    request.on('timeout', () => request.destroy(new ProbeFailure('timeout')));
    request.on('error', reject);
    request.end();
  });
}

async function fetchWithFallback(url: URL, addresses: string[], deadline: number): Promise<Hop> {
  let lastError: unknown = new ProbeFailure('timeout');
  for (const address of addresses.slice(0, MAX_ADDRESS_ATTEMPTS)) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      break;
    }
    try {
      return await fetchHop(url, address, remaining);
    } catch (error) {
      lastError = error;
      if (!RETRY_ON_NEXT_ADDRESS.has(toFailure(error).kind)) {
        throw error;
      }
    }
  }
  throw lastError;
}

export async function checkHttp(
  host: string,
  scheme: HttpScheme,
  hostAddresses: string[],
  timeoutMs: number,
): Promise<HttpAttempt> {
  const started = Date.now();
  const deadline = started + timeoutMs;
  let url = new URL(`${scheme}://${host}/`);
  let redirects = 0;
  const attempt = (fields: Partial<HttpAttempt>): HttpAttempt => ({
    scheme,
    status: null,
    finalUrl: url.toString(),
    redirects,
    error: null,
    errorCode: null,
    blockpage: false,
    durationMs: Date.now() - started,
    ...fields,
  });

  try {
    for (;;) {
      const addresses = await addressesFor(url.hostname, url.hostname === host ? hostAddresses : undefined);
      const hop = await fetchWithFallback(url, addresses, deadline);
      const blockpage = url.protocol === 'http:' && detectBlockpage(hop.body);
      const isRedirect = hop.status >= 300 && hop.status < 400 && hop.location !== null;
      if (!isRedirect || blockpage) {
        return attempt({ status: hop.status, blockpage });
      }
      if (redirects >= MAX_REDIRECTS) {
        throw new ProbeFailure('too_many_redirects');
      }
      url = nextRedirect(url, hop.location as string);
      redirects += 1;
    }
  } catch (error) {
    const failure = toFailure(error);
    return attempt({ error: failure.kind, errorCode: failure.code });
  }
}
