import type { ScheduledDownload } from '../core/types';
import { onKeyChanged, readList } from './storage-keys';

export const NIGHT_QUEUE_KEY = 'night-queue';

export function readScheduled(): Promise<ScheduledDownload[]> {
  return readList<ScheduledDownload>('local', NIGHT_QUEUE_KEY);
}

export function onScheduledChanged(listener: () => void): () => void {
  return onKeyChanged('local', NIGHT_QUEUE_KEY, listener);
}
