import type { CheckResult, OverviewStats } from './types';

export type Request =
  | { type: 'check'; domains: string[] }
  | { type: 'overview' }
  | { type: 'refresh' }
  | { type: 'clear-cache' };

export interface ResponseMap {
  check: { results: Record<string, CheckResult> };
  overview: OverviewStats;
  refresh: { ok: true };
  'clear-cache': { ok: true };
}
