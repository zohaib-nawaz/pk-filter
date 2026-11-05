import maxmind, { type CountryResponse } from 'maxmind';
import { isPublicIp } from '../utils/ip.js';
import { countryCode } from '../utils/country.js';

export interface GeoIp {
  country(ip: string): string | null;
}

export const noGeoIp: GeoIp = { country: () => null };

export async function openGeoIp(path: string, onError: (error: unknown) => void): Promise<GeoIp> {
  if (!path) {
    return noGeoIp;
  }
  try {
    const reader = await maxmind.open<CountryResponse>(path, { watchForUpdates: true });
    return {
      country(ip) {
        if (!isPublicIp(ip)) {
          return null;
        }
        const found = reader.get(ip);
        if (!found || !found.country) {
          return null;
        }
        return countryCode(found.country.iso_code);
      },
    };
  } catch (error) {
    onError(error);
    return noGeoIp;
  }
}
