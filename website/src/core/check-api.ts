import { AUTO_COUNTRY, isCountryCode } from '@shared/countries';
import { browserCountry } from '@shared/trace';
import type { CheckResult, CountrySource, MeasuredBy } from '@shared/types';
import { API_URL } from './config';

export interface SiteCheck {
  domain: string;
  country: string;
  countrySource: CountrySource;
  measuredBy: MeasuredBy;
  result: CheckResult | null;
}

const SOURCES = new Set<CountrySource>(['chosen', 'ip', 'default']);
const MEASURERS = new Set<MeasuredBy>(['probe', 'peer', 'ooni']);

export class CheckError extends Error {}

function isResult(value: unknown): value is CheckResult {
  const item = value as Partial<CheckResult> | null;
  return !!item && typeof item.domain === 'string' && typeof item.status === 'string' && Array.isArray(item.evidence) && !!item.network;
}

function failureText(status: number): string {
  if (status === 429) {
    return 'Too many checks from your network. Wait a minute and try again.';
  }
  if (status === 400) {
    return 'That does not look like a public website.';
  }
  return 'The checking service had a problem. Try again in a moment.';
}

async function requestCheck(domain: string, country: string): Promise<SiteCheck> {
  let response: Response;
  try {
    response = await fetch(`${API_URL}/api/v1/check`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ domains: [domain], country }),
      signal: AbortSignal.timeout(45_000),
    });
  } catch {
    throw new CheckError('Could not reach the checking service.');
  }
  if (!response.ok) {
    throw new CheckError(failureText(response.status));
  }
  const body = (await response.json()) as { results?: unknown[]; country?: unknown; countrySource?: unknown; measuredBy?: unknown };
  const results = Array.isArray(body.results) ? body.results.filter(isResult) : [];
  const result = results.find((item) => item.domain === domain);
  return {
    domain,
    country: isCountryCode(body.country) ? body.country : country,
    countrySource: SOURCES.has(body.countrySource as CountrySource) ? (body.countrySource as CountrySource) : 'default',
    measuredBy: MEASURERS.has(body.measuredBy as MeasuredBy) ? (body.measuredBy as MeasuredBy) : 'ooni',
    result: result ? result : null,
  };
}

export async function checkSite(domain: string, country: string): Promise<SiteCheck> {
  const first = await requestCheck(domain, country);
  if (country !== AUTO_COUNTRY || first.countrySource !== 'default') {
    return first;
  }
  const detected = await browserCountry();
  if (!detected) {
    return first;
  }
  if (detected === first.country) {
    return { ...first, countrySource: 'ip' };
  }
  return { ...(await requestCheck(domain, detected)), countrySource: 'ip' };
}
