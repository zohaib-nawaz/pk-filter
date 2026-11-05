import { countryCode } from '../utils/country.js';
import type { GeoIp } from './geoip.js';

export type CountrySource = 'chosen' | 'ip' | 'default';

export interface ViewerCountry {
  country: string;
  source: CountrySource;
}

export interface ViewerRequest {
  requested: string | undefined;
  ip: string;
  headerCountry: string | string[] | undefined;
}

export interface CountryResolverOptions {
  geoip: GeoIp;
  fallback: string;
  trustCountryHeader: boolean;
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

export function createCountryResolver(options: CountryResolverOptions) {
  return (request: ViewerRequest): ViewerCountry => {
    const chosen = countryCode(request.requested);
    if (chosen) {
      return { country: chosen, source: 'chosen' };
    }
    const fromHeader = options.trustCountryHeader ? countryCode(firstHeader(request.headerCountry)) : null;
    if (fromHeader) {
      return { country: fromHeader, source: 'ip' };
    }
    const fromIp = options.geoip.country(request.ip);
    if (fromIp) {
      return { country: fromIp, source: 'ip' };
    }
    return { country: options.fallback, source: 'default' };
  };
}

export type CountryResolver = ReturnType<typeof createCountryResolver>;
