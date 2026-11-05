import { isCountryCode } from './countries';

const TRACE_URL = 'https://www.cloudflare.com/cdn-cgi/trace';

export async function browserCountry(): Promise<string | null> {
  try {
    const response = await fetch(TRACE_URL, { credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(5_000) });
    if (!response.ok) {
      return null;
    }
    const line = (await response.text()).split('\n').find((entry) => entry.startsWith('loc='));
    if (!line) {
      return null;
    }
    const code = line.slice(4).trim().toUpperCase();
    return isCountryCode(code) ? code : null;
  } catch {
    return null;
  }
}
