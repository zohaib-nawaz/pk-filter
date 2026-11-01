import type { StreamPlan } from './hls';

export type StreamJobState = 'downloading' | 'paused' | 'saving' | 'complete' | 'failed' | 'cancelled';

export interface StreamJob {
  id: string;
  title: string;
  pageUrl: string;
  manifestUrl: string;
  extension: string;
  trackCount: number;
  state: StreamJobState;
  done: number;
  total: number;
  bytes: number;
  estimatedBytes: number | null;
  error: string | null;
  downloadIds: number[];
  startedAt: string;
}

export type StreamControl = 'pause' | 'resume' | 'cancel' | 'retry' | 'remove';

export type OffscreenCommand =
  | { target: 'offscreen'; type: 'run'; id: string; plan: StreamPlan }
  | { target: 'offscreen'; type: 'control'; id: string; action: 'pause' | 'resume' | 'cancel' }
  | { target: 'offscreen'; type: 'cleanup'; id: string };

export type OffscreenEvent =
  | { type: 'stream-progress'; id: string; done: number; bytes: number }
  | { type: 'stream-track-ready'; id: string; index: number; url: string; extension: string }
  | { type: 'stream-failed'; id: string; error: string; cancelled: boolean };

export const ACTIVE_STREAM_STATES = new Set<StreamJobState>(['downloading', 'paused', 'saving']);

export function newStreamJob(id: string, plan: StreamPlan, title: string, pageUrl: string, now: Date): StreamJob {
  return {
    id,
    title,
    pageUrl,
    manifestUrl: plan.manifestUrl,
    extension: plan.tracks[0]?.extension ?? 'ts',
    trackCount: plan.tracks.length,
    state: 'downloading',
    done: 0,
    total: plan.tracks.reduce((sum, track) => sum + track.segments.length + (track.init ? 1 : 0), 0),
    bytes: 0,
    estimatedBytes: plan.estimatedBytes,
    error: null,
    downloadIds: [],
    startedAt: now.toISOString(),
  };
}
