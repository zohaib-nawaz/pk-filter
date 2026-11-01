import { describeInterrupt } from './download-errors';
import type { DownloadRecord, DownloadView } from './types';

export interface DownloadSnapshot {
  state: string;
  paused: boolean;
  bytesReceived: number;
  totalBytes: number;
  canResume: boolean;
  error?: string;
  exists: boolean;
}

export function toDownloadView(record: DownloadRecord, item: DownloadSnapshot | undefined): DownloadView {
  if (!item) {
    return {
      record,
      state: 'missing',
      bytesReceived: 0,
      totalBytes: record.sizeBytes,
      canResume: false,
      error: 'Removed from Chrome downloads',
      fileExists: false,
    };
  }
  const cancelled = item.state === 'interrupted' && item.error === 'USER_CANCELED';
  const state = cancelled
    ? 'cancelled'
    : item.state === 'in_progress'
      ? item.paused
        ? 'paused'
        : 'in_progress'
      : item.state === 'complete'
        ? 'complete'
        : 'interrupted';
  return {
    record,
    state,
    bytesReceived: item.bytesReceived,
    totalBytes: item.totalBytes > 0 ? item.totalBytes : record.sizeBytes,
    canResume: item.canResume,
    error: state === 'interrupted' ? describeInterrupt(item.error) : null,
    fileExists: item.exists,
  };
}

export function progressPercent(view: DownloadView): number | null {
  if (view.state === 'complete') return 100;
  if (!view.totalBytes) return null;
  return Math.min(100, Math.floor((view.bytesReceived / view.totalBytes) * 100));
}

export function countActive(views: DownloadView[]): number {
  return views.filter((view) => view.state === 'in_progress' || view.state === 'paused').length;
}
