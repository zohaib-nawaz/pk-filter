import { isCountryCode } from './countries';
import type { OverviewStats, ServiceNetwork, ServiceStatus, SyncState, ViewerCountry } from './types';

type Loose<T> = { [K in keyof T]?: unknown };

function list<T>(value: unknown): T[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value as T[];
}

function textOrNull(value: unknown): string | null {
  if (typeof value === 'string') {
    return value;
  }
  return null;
}

function serviceFrom(value: unknown): ServiceStatus {
  const raw = (value || {}) as Loose<ServiceStatus>;
  return {
    online: raw.online === true,
    country: textOrNull(raw.country),
    network: (raw.network as ServiceStatus['network']) || null,
    networks: list<ServiceNetwork>(raw.networks),
    ooni: raw.ooni === true,
    probeCountries: list<unknown>(raw.probeCountries).filter(isCountryCode),
  };
}

function syncFrom(value: unknown): SyncState {
  const raw = (value || {}) as Loose<SyncState>;
  return { lastSync: textOrNull(raw.lastSync), lastError: textOrNull(raw.lastError) };
}

function viewerFrom(value: unknown): ViewerCountry | null {
  const raw = value as Loose<ViewerCountry> | null;
  if (!raw || !isCountryCode(raw.country)) {
    return null;
  }
  return value as ViewerCountry;
}

export function overviewFrom(value: unknown): OverviewStats | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const raw = value as Loose<OverviewStats>;
  return {
    cachedDomains: typeof raw.cachedDomains === 'number' ? raw.cachedDomains : 0,
    sync: syncFrom(raw.sync),
    service: serviceFrom(raw.service),
    viewer: viewerFrom(raw.viewer),
  };
}
