import { isIP } from 'node:net';
import { isPublicIp, stripBrackets } from './ip.js';

const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;
const TLD = /^(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/;
const PRIVATE_SUFFIXES = ['localhost', 'local', 'internal', 'intranet', 'lan', 'home', 'corp', 'arpa', 'test', 'invalid', 'onion', 'example'];

export function isPublicHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  if (host.length === 0 || host.length > 253 || isIP(host)) {
    return false;
  }
  const labels = host.split('.');
  const tld = labels.at(-1) ?? '';
  if (labels.length < 2 || !TLD.test(tld) || PRIVATE_SUFFIXES.includes(tld)) {
    return false;
  }
  return labels.every((label) => LABEL.test(label));
}

export function isSafeTargetHost(hostname: string): boolean {
  const host = stripBrackets(hostname);
  return isIP(host) ? isPublicIp(host) : isPublicHostname(host);
}

export function normalizeDomain(input: string): string | null {
  const raw = input.trim();
  if (raw.length === 0 || raw.length > 2048) {
    return null;
  }
  let url: URL;
  try {
    url = new URL(raw.includes('://') ? raw : `http://${raw}`);
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    return null;
  }
  const host = url.hostname.toLowerCase().replace(/\.$/, '').replace(/^www\./, '');
  return isPublicHostname(host) ? host : null;
}
