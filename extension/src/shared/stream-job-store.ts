import type { StreamJob } from '../core/stream-jobs';
import { onKeyChanged, readList } from './storage-keys';

export const STREAM_JOBS_KEY = 'stream-jobs';

export function readStreamJobs(): Promise<StreamJob[]> {
  return readList<StreamJob>('local', STREAM_JOBS_KEY);
}

export function onStreamJobsChanged(listener: () => void): () => void {
  return onKeyChanged('local', STREAM_JOBS_KEY, listener);
}
