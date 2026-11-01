import type { CheckResult, Settings } from './types';

export function expiresAt(result: CheckResult, settings: Settings, now: number): number {
  const minimumSeconds = result.status === 'unknown' ? 0 : settings.minCacheMinutes * 60;
  return now + Math.max(result.ttlSeconds, minimumSeconds) * 1000;
}

export function backoffDelay(failures: number): number {
  return Math.min(5 * 60_000, 2 ** Math.max(0, failures - 1) * 5_000);
}

export function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
}
