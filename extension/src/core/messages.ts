import type { CheckResult, MediaInfo, OverviewStats, PageVideo } from './types';

export type DownloadResult = { ok: true; id: number } | { ok: false; error: string };

export type Request =
  | { type: 'lookup'; domains: string[] }
  | { type: 'check'; domains: string[] }
  | { type: 'inspect-media'; url: string }
  | { type: 'download'; url: string; title: string }
  | { type: 'sync-video-sites' }
  | { type: 'page-videos'; videos: PageVideo[] }
  | { type: 'tab-videos'; tabId: number }
  | { type: 'overview' }
  | { type: 'refresh' }
  | { type: 'clear-cache' };

export interface ResponseMap {
  lookup: { results: Record<string, CheckResult> };
  check: { results: Record<string, CheckResult> };
  'inspect-media': MediaInfo;
  download: DownloadResult;
  'sync-video-sites': { ok: boolean };
  'page-videos': { ok: boolean };
  'tab-videos': { videos: PageVideo[] };
  overview: OverviewStats;
  refresh: { ok: true };
  'clear-cache': { ok: true };
}
