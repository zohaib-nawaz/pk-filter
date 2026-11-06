import { errorMessage } from '../core/errors';
import { audioOnlyPlan, type StreamPlan } from '../core/hls';
import type { DownloadResult } from '../core/messages';
import { ACTIVE_STREAM_STATES, chosenHeight, newStreamJob, type OffscreenCommand, type OffscreenEvent, type StreamControl, type StreamJob, type StreamJobOptions } from '../core/stream-jobs';
import { readStreamJobs, STREAM_JOBS_KEY } from '../shared/stream-job-store';
import { saveFile } from './download-names';
import { notify } from './notify';
import { resolveStream } from './stream-resolver';
import { streamJobOptions } from './stream-options';
import { saveSubtitles } from './subtitle-saver';

const MAX_JOBS = 50;
const OFFSCREEN_PATH = 'offscreen.html';
const SINGLE_OFFSCREEN = 'single offscreen document';
let watching = false;
let queue: Promise<unknown> = Promise.resolve();
let creating: Promise<void> | null = null;

function serial<T>(task: () => Promise<T>): Promise<T> {
  const next = queue.then(task, task);
  queue = next.catch(() => undefined);
  return next;
}

async function writeJobs(jobs: StreamJob[]): Promise<void> {
  await chrome.storage.local.set({ [STREAM_JOBS_KEY]: jobs.slice(0, MAX_JOBS) });
}

function updateJob(id: string, patch: (job: StreamJob) => Partial<StreamJob> | null): Promise<StreamJob | null> {
  return serial(async () => {
    const jobs = await readStreamJobs();
    const job = jobs.find((item) => item.id === id);
    if (!job) {
      return null;
    }
    const changes = patch(job);
    if (!changes) {
      return null;
    }
    Object.assign(job, changes);
    await writeJobs(jobs);
    return job;
  });
}

function whileActive(changes: Partial<StreamJob>): (job: StreamJob) => Partial<StreamJob> | null {
  return (job) => {
    if (!ACTIVE_STREAM_STATES.has(job.state)) {
      return null;
    }
    return changes;
  };
}

async function hasOffscreen(): Promise<boolean> {
  if (!streamsSupported()) {
    return false;
  }
  const url = chrome.runtime.getURL(OFFSCREEN_PATH);
  const contexts = await chrome.runtime.getContexts({ contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT], documentUrls: [url] });
  return contexts.length > 0;
}

async function createOffscreen(): Promise<void> {
  try {
    await chrome.offscreen.createDocument({
      url: OFFSCREEN_PATH,
      reasons: [chrome.offscreen.Reason.BLOBS],
      justification: 'Assemble downloaded stream segments into a single file on disk',
    });
  } catch (error) {
    if (!errorMessage(error, '').includes(SINGLE_OFFSCREEN)) {
      throw error;
    }
  }
}

async function ensureOffscreen(): Promise<void> {
  if (await hasOffscreen()) {
    return;
  }
  if (!creating) {
    creating = createOffscreen().finally(() => {
      creating = null;
    });
  }
  await creating;
}

async function command(message: OffscreenCommand): Promise<boolean> {
  try {
    await ensureOffscreen();
    await chrome.runtime.sendMessage(message);
    return true;
  } catch {
    return false;
  }
}

async function cleanupOffscreen(id: string): Promise<void> {
  if (await hasOffscreen()) {
    await command({ target: 'offscreen', type: 'cleanup', id });
  }
}

function cancelDownloads(job: StreamJob): void {
  for (const downloadId of job.downloadIds) {
    void chrome.downloads.cancel(downloadId).catch(() => undefined);
  }
}

function streamsSupported(): boolean {
  return Boolean(chrome.offscreen && chrome.runtime.getContexts);
}

async function planFor(url: string, options: StreamJobOptions): Promise<StreamPlan> {
  const plan = await resolveStream(url, options.maxHeight);
  if (!options.audioOnly) {
    return plan;
  }
  const audio = audioOnlyPlan(plan);
  if (!audio) {
    throw new Error('This stream has no separate audio track, so audio only is not available');
  }
  return audio;
}

export async function startStreamJob(url: string, title: string, pageUrl: string, options: StreamJobOptions): Promise<DownloadResult> {
  if (!chrome.downloads) {
    return { ok: false, error: 'Turn on the video downloader in the extension settings' };
  }
  if (!streamsSupported()) {
    return { ok: false, error: 'Stream downloads are not supported in this browser yet. Direct video files still work.' };
  }
  let plan: StreamPlan;
  try {
    plan = await planFor(url, options);
  } catch (error) {
    return { ok: false, error: errorMessage(error, 'Could not read this stream') };
  }
  const job = await serial(async () => {
    const jobs = await readStreamJobs();
    const height = chosenHeight(options.maxHeight);
    const sameJob = (item: StreamJob) => item.manifestUrl === plan.manifestUrl && Boolean(item.audioOnly) === options.audioOnly && item.maxHeight === height;
    if (jobs.some((item) => sameJob(item) && ACTIVE_STREAM_STATES.has(item.state))) {
      return null;
    }
    const created = newStreamJob(crypto.randomUUID(), plan, title.trim() || 'video', pageUrl, new Date(), options.audioOnly, options.maxHeight);
    await writeJobs([created, ...jobs]);
    return created;
  });
  if (!job) {
    return { ok: false, error: 'This stream is already downloading' };
  }
  watchStreamDownloads();
  if (!(await command({ target: 'offscreen', type: 'run', id: job.id, plan }))) {
    await updateJob(job.id, () => ({ state: 'failed', error: 'Could not start the download' }));
    return { ok: false, error: 'Could not start the download' };
  }
  if (options.saveSubtitles && plan.subtitles) {
    void saveSubtitles(plan.subtitles, job.title).catch(() => undefined);
  }
  return { ok: true };
}

async function saveTrack(event: Extract<OffscreenEvent, { type: 'stream-track-ready' }>): Promise<void> {
  const job = (await readStreamJobs()).find((item) => item.id === event.id);
  if (!job || !ACTIVE_STREAM_STATES.has(job.state)) {
    await cleanupOffscreen(event.id);
    return;
  }
  const suffix = job.trackCount > 1 && event.index > 0 ? ' (audio)' : '';
  const downloadId = await saveFile(event.url, `${job.title}${suffix}`, event.extension);
  const saved = await updateJob(event.id, (current) => {
    if (!ACTIVE_STREAM_STATES.has(current.state)) {
      return null;
    }
    const downloadIds = [...current.downloadIds, downloadId];
    return { downloadIds, state: downloadIds.length >= current.trackCount ? 'saving' : current.state };
  });
  if (!saved) {
    void chrome.downloads.cancel(downloadId).catch(() => undefined);
  }
}

export async function handleOffscreenEvent(event: OffscreenEvent): Promise<void> {
  if (event.type === 'stream-progress') {
    await updateJob(event.id, whileActive({ done: event.done, bytes: event.bytes }));
    return;
  }
  if (event.type === 'stream-track-ready') {
    await saveTrack(event).catch(async (error) => {
      await updateJob(event.id, whileActive({ state: 'failed', error: errorMessage(error, 'Could not save the file') }));
      await cleanupOffscreen(event.id);
    });
    return;
  }
  if (event.type === 'stream-split') {
    await updateJob(event.id, whileActive({ trackCount: event.trackCount }));
    return;
  }
  const job = await updateJob(event.id, whileActive({ state: event.cancelled ? 'cancelled' : 'failed', error: event.error }));
  if (job) {
    cancelDownloads(job);
  }
  if (job && !event.cancelled) {
    notify(`stream-${job.id}`, 'Download failed', `${job.title}: ${event.error}`);
  }
}

async function allComplete(job: StreamJob): Promise<boolean> {
  if (job.downloadIds.length < job.trackCount) {
    return false;
  }
  const items = await Promise.all(job.downloadIds.map((id) => chrome.downloads.search({ id })));
  return items.every(([item]) => item?.state === 'complete');
}

async function handleDownloadChange(delta: chrome.downloads.DownloadDelta): Promise<void> {
  const state = delta.state?.current;
  if (state !== 'complete' && state !== 'interrupted') {
    return;
  }
  const job = (await readStreamJobs()).find((item) => item.downloadIds.includes(delta.id));
  if (!job || !ACTIVE_STREAM_STATES.has(job.state)) {
    return;
  }
  if (state === 'interrupted') {
    const failed = await updateJob(job.id, whileActive({ state: 'failed', error: 'Saving the file was interrupted' }));
    if (failed) {
      await command({ target: 'offscreen', type: 'control', id: job.id, action: 'cancel' });
      cancelDownloads(failed);
    }
    await cleanupOffscreen(job.id);
    return;
  }
  if (!(await allComplete(job))) {
    return;
  }
  const finished = await updateJob(job.id, whileActive({ state: 'complete' }));
  await cleanupOffscreen(job.id);
  if (finished) {
    notify(`stream-${finished.id}`, 'Download complete', finished.title);
  }
}

export function watchStreamDownloads(): void {
  if (watching || !chrome.downloads) {
    return;
  }
  watching = true;
  chrome.downloads.onChanged.addListener((delta) => void handleDownloadChange(delta));
}

async function cancelJob(job: StreamJob): Promise<void> {
  await command({ target: 'offscreen', type: 'control', id: job.id, action: 'cancel' });
  const cancelled = await updateJob(job.id, whileActive({ state: 'cancelled', error: 'Cancelled' }));
  if (cancelled) {
    cancelDownloads(cancelled);
  }
  await cleanupOffscreen(job.id);
}

export async function controlStreamJob(id: string, action: StreamControl): Promise<{ ok: boolean }> {
  const job = (await readStreamJobs()).find((item) => item.id === id);
  if (!job) {
    return { ok: false };
  }
  if (action === 'pause' || action === 'resume') {
    await command({ target: 'offscreen', type: 'control', id, action });
    await updateJob(id, (current) => {
      if (current.state !== 'downloading' && current.state !== 'paused') {
        return null;
      }
      return { state: action === 'pause' ? 'paused' : 'downloading' };
    });
    return { ok: true };
  }
  if (action === 'cancel') {
    await cancelJob(job);
    return { ok: true };
  }
  if (ACTIVE_STREAM_STATES.has(job.state)) {
    return { ok: false };
  }
  if (action === 'retry') {
    const result = await startStreamJob(job.manifestUrl, job.title, job.pageUrl, await streamJobOptions(job.audioOnly === true, job.maxHeight));
    if (!result.ok) {
      return { ok: false };
    }
  }
  await serial(async () => writeJobs((await readStreamJobs()).filter((item) => item.id !== id)));
  await cleanupOffscreen(id);
  return { ok: true };
}

export async function failInterruptedJobs(): Promise<void> {
  if (await hasOffscreen()) {
    return;
  }
  await serial(async () => {
    const jobs = await readStreamJobs();
    const interrupted = jobs.filter((job) => ACTIVE_STREAM_STATES.has(job.state));
    if (interrupted.length === 0) {
      return;
    }
    for (const job of interrupted) {
      Object.assign(job, { state: 'failed', error: 'The download stopped before it finished' });
    }
    await writeJobs(jobs);
  });
}
