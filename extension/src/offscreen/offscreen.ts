import { interleave, mergeInitSegments, retagFragment } from '../core/fmp4';
import type { StreamPlan, StreamSegment, StreamTrack } from '../core/hls';
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

interface JobContext {
  id: string;
  job: RunningJob;
  root: FileSystemDirectoryHandle;
  progress: (added: number) => void;
  waitIfPaused: () => Promise<void>;
  flush: () => void;
}

async function writeFile(
  context: JobContext,
  name: string,
  write: (writable: FileSystemWritableFileStream) => Promise<void>,
): Promise<FileSystemFileHandle> {
  const handle = await context.root.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  try {
    await write(writable);
    await writable.close();
  } catch (error) {
    await writable.abort().catch(() => undefined);
    throw error;
  }
  return handle;
}

async function publish(context: JobContext, handle: FileSystemFileHandle, index: number, extension: string): Promise<void> {
  const url = URL.createObjectURL(await handle.getFile());
  context.job.urls.push(url);
  blobUrls.set(context.id, context.job.urls);
  context.flush();
  emit({ type: 'stream-track-ready', id: context.id, index, url, extension });
}

async function saveSeparately(context: JobContext, tracks: StreamTrack[]): Promise<void> {
  for (const [index, track] of tracks.entries()) {
    const handle = await writeFile(context, fileName(context.id, index, track.extension), async (writable) => {
      if (track.init) {
        const init = await fetchSegment(track.init, context.job.abort.signal);
        await writable.write(init);
        context.progress(init.byteLength);
      }
      await runSegments({
        items: track.segments,
        concurrency: CONCURRENCY,
        attempts: ATTEMPTS,
        signal: context.job.abort.signal,
        fetchSegment,
        write: (chunk) => writable.write(chunk),
        waitIfPaused: context.waitIfPaused,
        onSegment: context.progress,
      });
    });
    await publish(context, handle, index, track.extension);
  }
}

async function saveCombined(context: JobContext, video: StreamTrack, audio: StreamTrack): Promise<boolean> {
  const signal = context.job.abort.signal;
  const [videoInit, audioInit] = await Promise.all([
    fetchSegment(video.init as StreamSegment, signal),
    fetchSegment(audio.init as StreamSegment, signal),
  ]);
  let merged;
  try {
    merged = mergeInitSegments(videoInit, audioInit);
  } catch {
    return false;
  }
  context.progress(videoInit.byteLength);
  context.progress(audioInit.byteLength);
  const items = interleave(
    video.segments.map((segment) => ({ segment, audio: false })),
    audio.segments.map((segment) => ({ segment, audio: true })),
  );
  const handle = await writeFile(context, fileName(context.id, 0, 'mp4'), async (writable) => {
    await writable.write(merged.init);
    await runSegments({
      items,
      concurrency: CONCURRENCY,
      attempts: ATTEMPTS,
      signal,
      fetchSegment: async (item, itemSignal) => {
        const bytes = await fetchSegment(item.segment, itemSignal);
        return item.audio ? retagFragment(bytes, merged.audioTrackId) : bytes;
      },
      write: (chunk) => writable.write(chunk),
      waitIfPaused: context.waitIfPaused,
      onSegment: context.progress,
    });
  });
  await publish(context, handle, 0, 'mp4');
  return true;
}

async function run(id: string, plan: StreamPlan): Promise<void> {
  const job: RunningJob = { abort: new AbortController(), paused: false, resume: null, urls: [] };
  jobs.set(id, job);
  let done = 0;
  let bytes = 0;
  let lastEmit = 0;
  const context: JobContext = {
    id,
    job,
    root: await navigator.storage.getDirectory(),
    progress: (added) => {
      done += 1;
      bytes += added;
      if (Date.now() - lastEmit < PROGRESS_INTERVAL_MS) return;
      lastEmit = Date.now();
      emit({ type: 'stream-progress', id, done, bytes });
    },
    waitIfPaused: () => (job.paused ? new Promise<void>((resolve) => (job.resume = resolve)) : Promise.resolve()),
    flush: () => emit({ type: 'stream-progress', id, done, bytes }),
  };

  try {
    const [video, audio] = plan.tracks;
    const combined = plan.combine && video && audio ? await saveCombined(context, video, audio) : false;
    if (!combined) {
      if (plan.combine) emit({ type: 'stream-split', id, trackCount: plan.tracks.length });
      await saveSeparately(context, plan.tracks);
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
