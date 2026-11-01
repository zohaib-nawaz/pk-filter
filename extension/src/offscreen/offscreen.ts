import type { StreamPlan, StreamSegment } from '../core/hls';
import { runSegments, SegmentError, type SegmentChunk } from '../core/segment-pipeline';
import type { OffscreenCommand, OffscreenEvent } from '../core/stream-jobs';

interface RunningJob {
  abort: AbortController;
  paused: boolean;
  resume: (() => void) | null;
  urls: string[];
}

const CONCURRENCY = 4;
const ATTEMPTS = 3;
const PROGRESS_INTERVAL_MS = 500;
const jobs = new Map<string, RunningJob>();
const blobUrls = new Map<string, string[]>();

function emit(event: OffscreenEvent): void {
  void chrome.runtime.sendMessage(event).catch(() => undefined);
}

async function fetchSegment(segment: StreamSegment, signal: AbortSignal): Promise<SegmentChunk> {
  const headers: HeadersInit = segment.range ? { range: `bytes=${segment.range.start}-${segment.range.end}` } : {};
  const response = await fetch(segment.url, { credentials: 'include', signal, headers });
  if (segment.range && response.status === 200) throw new SegmentError('The stream server ignored the byte range request', false);
  if (!response.ok) {
    const retryable = response.status >= 500 || response.status === 429;
    throw new SegmentError(retryable ? `Stream server error ${response.status}` : `Stream segment returned ${response.status}`, retryable);
  }
  return new Uint8Array(await response.arrayBuffer());
}

function fileName(id: string, index: number, extension: string): string {
  return `${id}-${index}.${extension}`;
}

async function removeFiles(id: string): Promise<void> {
  const root = await navigator.storage.getDirectory();
  for await (const name of (root as unknown as { keys(): AsyncIterable<string> }).keys()) {
    if (name.startsWith(`${id}-`)) await root.removeEntry(name).catch(() => undefined);
  }
}

async function clearStaleFiles(): Promise<void> {
  const root = await navigator.storage.getDirectory();
  for await (const name of (root as unknown as { keys(): AsyncIterable<string> }).keys()) {
    await root.removeEntry(name).catch(() => undefined);
  }
}

async function run(id: string, plan: StreamPlan): Promise<void> {
  const job: RunningJob = { abort: new AbortController(), paused: false, resume: null, urls: [] };
  jobs.set(id, job);
  const root = await navigator.storage.getDirectory();
  let done = 0;
  let bytes = 0;
  let lastEmit = 0;
  const progress = (added: number) => {
    done += 1;
    bytes += added;
    if (Date.now() - lastEmit < PROGRESS_INTERVAL_MS) return;
    lastEmit = Date.now();
    emit({ type: 'stream-progress', id, done, bytes });
  };
  const waitIfPaused = () => (job.paused ? new Promise<void>((resolve) => (job.resume = resolve)) : Promise.resolve());

  try {
    for (const [index, track] of plan.tracks.entries()) {
      const handle = await root.getFileHandle(fileName(id, index, track.extension), { create: true });
      const writable = await handle.createWritable();
      try {
        if (track.init) {
          const init = await fetchSegment(track.init, job.abort.signal);
          await writable.write(init);
          progress(init.byteLength);
        }
        await runSegments({
          items: track.segments,
          concurrency: CONCURRENCY,
          attempts: ATTEMPTS,
          signal: job.abort.signal,
          fetchSegment,
          write: (chunk) => writable.write(chunk),
          waitIfPaused,
          onSegment: progress,
        });
        await writable.close();
      } catch (error) {
        await writable.abort().catch(() => undefined);
        throw error;
      }
      const url = URL.createObjectURL(await handle.getFile());
      job.urls.push(url);
      blobUrls.set(id, job.urls);
      emit({ type: 'stream-progress', id, done, bytes });
      emit({ type: 'stream-track-ready', id, index, url, extension: track.extension });
    }
  } catch (error) {
    const cancelled = job.abort.signal.aborted;
    await removeFiles(id);
    emit({ type: 'stream-failed', id, cancelled, error: cancelled ? 'Cancelled' : error instanceof Error ? error.message : 'Stream download failed' });
  } finally {
    jobs.delete(id);
  }
}

function control(id: string, action: 'pause' | 'resume' | 'cancel'): void {
  const job = jobs.get(id);
  if (!job) return;
  if (action === 'pause') job.paused = true;
  if (action === 'resume' || action === 'cancel') {
    job.paused = false;
    job.resume?.();
    job.resume = null;
  }
  if (action === 'cancel') job.abort.abort();
}

async function cleanup(id: string): Promise<void> {
  for (const url of blobUrls.get(id) ?? []) URL.revokeObjectURL(url);
  blobUrls.delete(id);
  await removeFiles(id);
}

chrome.runtime.onMessage.addListener((message: OffscreenCommand, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || message?.target !== 'offscreen') return false;
  if (message.type === 'run') void run(message.id, message.plan);
  if (message.type === 'control') control(message.id, message.action);
  if (message.type === 'cleanup') void cleanup(message.id);
  sendResponse({ ok: true });
  return false;
});

void clearStaleFiles();
