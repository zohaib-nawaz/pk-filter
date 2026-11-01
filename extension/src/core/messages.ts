import type { CheckResult, MediaInfo, OverviewStats } from './types';

export type DownloadResult = { ok: true; id: number } | { ok: false; error: string };

export type Request =
  | { type: 'lookup'; domains: string[] }
  | { type: 'check'; domains: string[] }
  | { type: 'inspect-media'; url: string }
  | { type: 'download'; url: string; title: string }
  | { type: 'sync-video-sites' }
  | { type: 'overview' }
  | { type: 'refresh' }
  | { type: 'clear-cache' };

export interface ResponseMap {
  lookup: { results: Record<string, CheckResult> };
  check: { results: Record<string, CheckResult> };
  'inspect-media': MediaInfo;
  download: DownloadResult;
  'sync-video-sites': { ok: boolean };
  overview: OverviewStats;
  refresh: { ok: true };
  'clear-cache': { ok: true };
}
