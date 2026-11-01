export type AccessStatus = 'accessible' | 'blocked' | 'possibly_blocked' | 'unknown' | 'server_error';

export type DisplayStatus = AccessStatus | 'checking';

export type FilterMode = 'all' | 'hide_blocked' | 'only_accessible';

export interface ProbeNetwork {
  isp: string;
  asn: string;
  city: string;
}

export interface CheckResult {
  domain: string;
  status: AccessStatus;
  confidence: number;
  country: string;
  lastChecked: string;
  evidence: string[];
  method: string;
  network: ProbeNetwork;
  ttlSeconds: number;
}

export interface Settings {
  enabled: boolean;
  filterMode: FilterMode;
  showUnknown: boolean;
  minCacheMinutes: number;
}

export interface SyncState {
  lastSync: string | null;
  lastError: string | null;
}

export interface ServiceStatus {
  online: boolean;
  country: string | null;
  network: ProbeNetwork | null;
  ooni: boolean;
}

export interface OverviewStats {
  cachedDomains: number;
  sync: SyncState;
  service: ServiceStatus;
}
