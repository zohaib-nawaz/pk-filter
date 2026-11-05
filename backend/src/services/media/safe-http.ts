import http, { type IncomingHttpHeaders, type IncomingMessage } from 'node:http';
import https from 'node:https';
import { isIP, type LookupFunction } from 'node:net';
import { brotliDecompressSync, gunzipSync, inflateSync } from 'node:zlib';
import { isSafeTargetHost } from '../../utils/domain.js';
import { isPublicIp, stripBrackets } from '../../utils/ip.js';
import { resolveAddresses } from '../dns-checker.js';

export type MediaFailure = 'invalid_url' | 'unsafe_address' | 'dns' | 'timeout' | 'too_large' | 'http_error' | 'network';

export class MediaFetchError extends Error {
  constructor(
    readonly failure: MediaFailure,
    message: string,
    readonly status: number | null = null,
  ) {
    super(message);
  }
}

export interface SafeResponse {
  status: number;
  headers: IncomingHttpHeaders;
  finalUrl: string;
  body: IncomingMessage;
}

export interface SafeRequest {
  range?: { start: number; end: number | null };
  timeoutMs?: number;
  signal?: AbortSignal;
  referer?: string;
}

const MAX_REDIRECTS = 5;
const MAX_ADDRESS_ATTEMPTS = 2;
const DEFAULT_TIMEOUT_MS = 20_000;
const IDLE_TIMEOUT_MS = 30_000;
const ALLOWED_PORTS = new Set(['', '80', '443', '8080', '8443']);
const HEADERS = {
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
  accept: '*/*',
  'accept-language': 'en-US,en;q=0.8',
  'accept-encoding': 'identity',
};
const AGENTS = {
  http: new http.Agent({ keepAlive: true, maxSockets: 32, maxFreeSockets: 8, timeout: 30_000 }),
  https: new https.Agent({ keepAlive: true, maxSockets: 32, maxFreeSockets: 8, timeout: 30_000 }),
};
const CONNECT_FAILURES = new Set(['ECONNREFUSED', 'ECONNRESET', 'EHOSTUNREACH', 'ENETUNREACH', 'ETIMEDOUT', 'EADDRNOTAVAIL']);

export function safeMediaUrl(raw: string, base?: string): URL | null {
  let url: URL;
  try {
    url = new URL(raw, base);
  } catch {
    return null;
  }
  const allowed = (url.protocol === 'http:' || url.protocol === 'https:') && ALLOWED_PORTS.has(url.port) && !url.username && !url.password;
  if (!allowed || !isSafeTargetHost(url.hostname)) {
    return null;
  }
  return url;
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

async function publicAddresses(hostname: string): Promise<string[]> {
  const host = stripBrackets(hostname);
  const addresses = isIP(host) ? [host] : await resolveAddresses(host);
  if (addresses.length === 0) {
    throw new MediaFetchError('dns', 'The website address could not be found');
  }
  if (!addresses.every(isPublicIp)) {
    throw new MediaFetchError('unsafe_address', 'This address is not a public website');
  }
  return [...addresses.filter((address) => isIP(address) === 4), ...addresses.filter((address) => isIP(address) === 6)];
}

function requestHeaders(options: SafeRequest): Record<string, string> {
  const headers: Record<string, string> = { ...HEADERS };
  if (options.range) {
    headers.range = `bytes=${options.range.start}-${options.range.end === null ? '' : options.range.end}`;
  }
  if (options.referer) {
    headers.referer = options.referer;
  }
  return headers;
}

function isConnectFailure(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code;
  return typeof code === 'string' && CONNECT_FAILURES.has(code);
}

function linkAbort(source: AbortSignal | undefined, target: AbortController): () => void {
  if (!source) {
    return () => undefined;
  }
  if (source.aborted) {
    target.abort();
    return () => undefined;
  }
  const onAbort = () => target.abort();
  source.addEventListener('abort', onAbort, { once: true });
  return () => source.removeEventListener('abort', onAbort);
}

function requestOnce(url: URL, address: string, options: SafeRequest): Promise<IncomingMessage> {
  const secure = url.protocol === 'https:';
  const transport = secure ? https : http;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const unlink = linkAbort(options.signal, controller);
  return new Promise((resolve, reject) => {
    const headerTimer = setTimeout(() => controller.abort(), timeoutMs);
    const request = transport.request(
      url,
      {
        method: 'GET',
        headers: requestHeaders(options),
        lookup: pinnedLookup(address),
        agent: secure ? AGENTS.https : AGENTS.http,
        timeout: IDLE_TIMEOUT_MS,
        signal: controller.signal,
      },
      (response) => {
        clearTimeout(headerTimer);
        response.once('close', unlink);
        resolve(response);
      },
    );
    request.on('timeout', () => request.destroy(new MediaFetchError('timeout', 'The website stopped sending data')));
    request.on('error', (error) => {
      clearTimeout(headerTimer);
      unlink();
      if (controller.signal.aborted && !(options.signal && options.signal.aborted)) {
        reject(new MediaFetchError('timeout', 'The website took too long to answer'));
        return;
      }
      reject(error);
    });
    request.end();
  });
}

async function requestAnyAddress(url: URL, options: SafeRequest): Promise<IncomingMessage> {
  const addresses = (await publicAddresses(url.hostname)).slice(0, MAX_ADDRESS_ATTEMPTS);
  let lastError: unknown = null;
  for (const address of addresses) {
    try {
      return await requestOnce(url, address, options);
    } catch (error) {
      lastError = error;
      if (error instanceof MediaFetchError || !isConnectFailure(error) || (options.signal && options.signal.aborted)) {
        break;
      }
    }
  }
  if (lastError instanceof MediaFetchError) {
    throw lastError;
  }
  throw new MediaFetchError('network', 'Could not connect to the website');
}

export async function openSafe(raw: string, options: SafeRequest = {}): Promise<SafeResponse> {
  let url = safeMediaUrl(raw);
  if (!url) {
    throw new MediaFetchError('invalid_url', 'Only public http and https links are supported');
  }
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const response = await requestAnyAddress(url, options);
    const status = response.statusCode ?? 0;
    const location = response.headers.location;
    if (status < 300 || status >= 400 || !location) {
      return { status, headers: response.headers, finalUrl: url.toString(), body: response };
    }
    response.resume();
    const next = safeMediaUrl(location, url.toString());
    if (!next) {
      throw new MediaFetchError('unsafe_address', 'The link redirects to an address that is not allowed');
    }
    url = next;
  }
  throw new MediaFetchError('http_error', 'The link redirects too many times');
}

function decoded(body: Buffer, encoding: string | string[] | undefined): Buffer {
  const name = String(Array.isArray(encoding) ? encoding[0] : encoding || '').toLowerCase();
  try {
    if (name === 'gzip' || name === 'x-gzip') {
      return gunzipSync(body);
    }
    if (name === 'deflate') {
      return inflateSync(body);
    }
    if (name === 'br') {
      return brotliDecompressSync(body);
    }
  } catch {
    throw new MediaFetchError('http_error', 'The website sent a response that could not be read');
  }
  return body;
}

export function asFetchError(error: unknown): MediaFetchError {
  if (error instanceof MediaFetchError) {
    return error;
  }
  const name = (error as Error | null)?.name;
  if (name === 'AbortError' || name === 'TimeoutError') {
    return new MediaFetchError('timeout', 'The download was interrupted');
  }
  return new MediaFetchError('network', 'The connection to the website was lost');
}

export async function* bodyChunks(response: SafeResponse): AsyncGenerator<Uint8Array> {
  try {
    for await (const chunk of response.body) {
      yield chunk as Uint8Array;
    }
  } catch (error) {
    throw asFetchError(error);
  }
}

export async function readBody(response: SafeResponse, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of bodyChunks(response)) {
    const buffer = Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
    size += buffer.length;
    if (size > maxBytes) {
      response.body.destroy();
      throw new MediaFetchError('too_large', 'The response is too large');
    }
    chunks.push(buffer);
  }
  return decoded(Buffer.concat(chunks), response.headers['content-encoding']);
}

export function expectOk(response: SafeResponse): void {
  if (response.status >= 200 && response.status < 300) {
    return;
  }
  response.body.resume();
  throw new MediaFetchError('http_error', `The website answered with status ${response.status}`, response.status);
}

export async function fetchText(raw: string, maxBytes: number, options: SafeRequest = {}): Promise<{ text: string; finalUrl: string }> {
  const response = await openSafe(raw, options);
  expectOk(response);
  return { text: (await readBody(response, maxBytes)).toString('utf8'), finalUrl: response.finalUrl };
}

export async function fetchBytes(raw: string, maxBytes: number, options: SafeRequest = {}): Promise<Uint8Array> {
  const response = await openSafe(raw, { timeoutMs: 30_000, ...options });
  expectOk(response);
  if (options.range && response.status === 200 && options.range.start > 0) {
    response.body.destroy();
    throw new MediaFetchError('http_error', 'The server ignored the byte range request');
  }
  return new Uint8Array(await readBody(response, maxBytes));
}
