import { createLimiter } from '../core/limiter';
import type { LocalProbe } from '../core/types';

const TIMEOUT_MS = 8_000;
const FRESH_MS = 10 * 60_000;
const MAX_ENTRIES = 2_000;
const limit = createLimiter(4);
const results = new Map<string, { probe: LocalProbe; at: number }>();

async function opens(url: string): Promise<boolean> {
  try {
    await fetch(url, { method: 'HEAD', mode: 'no-cors', credentials: 'omit', cache: 'no-store', redirect: 'follow', signal: AbortSignal.timeout(TIMEOUT_MS) });
    return true;
  } catch {
    return false;
  }
}

async function measure(domain: string): Promise<LocalProbe> {
  if ((await opens(`https://${domain}/`)) || (await opens(`https://www.${domain}/`))) {
    return 'reachable';
  }
  return 'failed';
}

function remember(key: string, probe: LocalProbe): void {
  results.delete(key);
  results.set(key, { probe, at: Date.now() });
  if (results.size > MAX_ENTRIES) {
    const oldest = results.keys().next();
    if (!oldest.done) {
      results.delete(oldest.value);
    }
  }
}

export function knownLocalProbe(country: string, domain: string): LocalProbe | null {
  const entry = results.get(`${country}:${domain}`);
  if (!entry || Date.now() - entry.at > FRESH_MS) {
    return null;
  }
  return entry.probe;
}

export async function localProbe(country: string, domain: string): Promise<LocalProbe> {
  const known = knownLocalProbe(country, domain);
  if (known) {
    return known;
  }
  const probe = await limit(() => measure(domain));
  remember(`${country}:${domain}`, probe);
  return probe;
}
