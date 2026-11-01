import { describeInterrupt } from './download-errors';
import type { StreamJob } from './stream-jobs';
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
      kind: 'file',
      streamId: null,
      percent: null,
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
    kind: 'file',
    streamId: null,
    percent: null,
    record,
    state,
    bytesReceived: item.bytesReceived,
    totalBytes: item.totalBytes > 0 ? item.totalBytes : record.sizeBytes,
    canResume: item.canResume,
    error: state === 'interrupted' ? describeInterrupt(item.error) : null,
    fileExists: item.exists,
  };
}

const STREAM_STATES: Record<StreamJob['state'], DownloadView['state']> = {
  downloading: 'in_progress',
  saving: 'in_progress',
  paused: 'paused',
  complete: 'complete',
  failed: 'interrupted',
  cancelled: 'cancelled',
};

export function toStreamView(job: StreamJob): DownloadView {
  const percent = job.state === 'saving' ? 100 : job.total > 0 ? Math.floor((job.done / job.total) * 100) : 0;
  return {
    kind: 'stream',
    streamId: job.id,
    percent,
    record: {
      id: job.downloadIds[0] ?? -1,
      url: job.manifestUrl,
      title: job.title,
      extension: job.extension,
      sizeBytes: job.estimatedBytes,
      startedAt: job.startedAt,
    },
    state: STREAM_STATES[job.state],
    bytesReceived: job.bytes,
    totalBytes: job.state === 'complete' ? job.bytes : null,
    canResume: false,
    error: job.state === 'failed' ? job.error : null,
    fileExists: job.state === 'complete' && job.downloadIds.length > 0,
  };
}

export function progressPercent(view: DownloadView): number | null {
  if (view.state === 'complete') return 100;
  if (view.percent !== null) return view.percent;
  if (!view.totalBytes) return null;
  return Math.min(100, Math.floor((view.bytesReceived / view.totalBytes) * 100));
}

export function countActive(views: DownloadView[]): number {
  return views.filter((view) => view.state === 'in_progress' || view.state === 'paused').length;
}
