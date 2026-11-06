import type { MediaQuality } from './hls';

export type AccessStatus = 'accessible' | 'blocked' | 'possibly_blocked' | 'unknown' | 'server_error';

export type DisplayStatus = AccessStatus | 'checking';

export type FilterMode = 'all' | 'hide_blocked' | 'only_accessible';

export type LocalProbe = 'reachable' | 'failed';

export type CountrySource = 'chosen' | 'ip' | 'default';

export type MeasuredBy = 'probe' | 'peer' | 'ooni';

export interface ViewerCountry {
  country: string;
  source: CountrySource;
  measuredBy: MeasuredBy;
}

export type StreamQuality = 'best' | '1080' | '720' | '480' | '360';

export interface ProbeNetwork {
  isp: string;
  asn: string;
  city: string;
}

export interface NetworkResult {
  isp: string;
  asn: string;
  city: string;
  status: AccessStatus;
  confidence: number;
  lastChecked: string;
  evidence: string[];
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
  networks?: NetworkResult[];
  localCheck?: LocalProbe;
}

export interface Settings {
  enabled: boolean;
  filterMode: FilterMode;
  showUnknown: boolean;
  minCacheMinutes: number;
  videoDownloader: boolean;
  videoOnGoogle: boolean;
  videoOnPages: boolean;
  videoShowUnavailable: boolean;
  streamDomains: string[];
  preferredIsp: string;
  explainFailures: boolean;
  streamQuality: StreamQuality;
  saveSubtitles: boolean;
  nightStartHour: number;
  nightEndHour: number;
  country: string;
  localCheck: boolean;
}

export interface SyncState {
  lastSync: string | null;
  lastError: string | null;
}

export interface ServiceNetwork extends ProbeNetwork {
  online: boolean;
}

export interface ServiceStatus {
  online: boolean;
  country: string | null;
  network: ProbeNetwork | null;
  networks: ServiceNetwork[];
  ooni: boolean;
  probeCountries: string[];
}

export interface SiteHistory {
  available: boolean;
  days: Array<{ day: string; status: AccessStatus }>;
  blockedSince: string | null;
}

export interface SiteStatus {
  domain: string;
  result: CheckResult | null;
  history: SiteHistory | null;
}

export interface OverviewStats {
  cachedDomains: number;
  sync: SyncState;
  service: ServiceStatus;
  viewer: ViewerCountry | null;
}

export type MediaStatus = 'downloadable' | 'streaming' | 'protected' | 'unavailable' | 'unsupported';

export interface MediaInfo {
  status: MediaStatus;
  url: string;
  extension: string | null;
  mime: string | null;
  sizeBytes: number | null;
  reason: string;
  separateAudio?: boolean;
  qualities?: MediaQuality[];
  audioOnly?: boolean;
}

export interface DownloadRecord {
  id: number;
  url: string;
  title: string;
  extension: string;
  sizeBytes: number | null;
  startedAt: string;
}

export type DownloadState = 'in_progress' | 'paused' | 'complete' | 'interrupted' | 'cancelled' | 'missing';

export interface DownloadView {
  kind: 'file' | 'stream';
  streamId: string | null;
  percent: number | null;
  record: DownloadRecord;
  state: DownloadState;
  bytesReceived: number;
  totalBytes: number | null;
  canResume: boolean;
  error: string | null;
  fileExists: boolean;
}

export interface PageVideo {
  url: string;
  title: string;
  extension: string;
  sizeBytes: number | null;
  separateAudio?: boolean;
}

export interface DownloadOptions {
  audioOnly: boolean;
  maxHeight?: number;
}

export interface ScheduledDownload {
  id: string;
  url: string;
  title: string;
  pageUrl: string | null;
  audioOnly: boolean;
  addedAt: string;
  error?: string;
}
