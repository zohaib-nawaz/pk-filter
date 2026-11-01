import type { CheckResult, MediaInfo, OverviewStats, PageVideo } from './types';

import type { OffscreenEvent, StreamControl } from './stream-jobs';

export type DownloadResult = { ok: true } | { ok: false; error: string };

export type Request =
  | { type: 'lookup'; domains: string[] }
  | { type: 'check'; domains: string[] }
  | { type: 'inspect-media'; url: string }
  | { type: 'download'; url: string; title: string; pageUrl?: string }
  | { type: 'stream-control'; id: string; action: StreamControl }
  | OffscreenEvent
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
  'stream-control': { ok: boolean };
  'stream-progress': { ok: boolean };
  'stream-track-ready': { ok: boolean };
  'stream-failed': { ok: boolean };
  overview: OverviewStats;
  refresh: { ok: true };
  'clear-cache': { ok: true };
}
