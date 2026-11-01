import { buildFilename } from '../core/filename';
import type { DownloadResult } from '../core/messages';
import { ACTIVE_STREAM_STATES, newStreamJob, type OffscreenCommand, type OffscreenEvent, type StreamControl, type StreamJob } from '../core/stream-jobs';
import { resolveStream } from './stream-resolver';

const JOBS_KEY = 'stream-jobs';
const MAX_JOBS = 50;
const OFFSCREEN_PATH = 'offscreen.html';
let watching = false;
let queue: Promise<unknown> = Promise.resolve();

function serial<T>(task: () => Promise<T>): Promise<T> {
  const next = queue.then(task, task);
  queue = next.catch(() => undefined);
  return next;
}

export async function readStreamJobs(): Promise<StreamJob[]> {
  const stored = await chrome.storage.local.get(JOBS_KEY);
  return (stored[JOBS_KEY] as StreamJob[] | undefined) ?? [];
}

async function writeJobs(jobs: StreamJob[]): Promise<void> {
  await chrome.storage.local.set({ [JOBS_KEY]: jobs.slice(0, MAX_JOBS) });
}

function updateJob(id: string, patch: (job: StreamJob) => Partial<StreamJob>): Promise<StreamJob | null> {
  return serial(async () => {
    const jobs = await readStreamJobs();
    const job = jobs.find((item) => item.id === id);
    if (!job) return null;
    Object.assign(job, patch(job));
    await writeJobs(jobs);
    return job;
  });
}

async function ensureOffscreen(): Promise<void> {
  const url = chrome.runtime.getURL(OFFSCREEN_PATH);
  const contexts = await chrome.runtime.getContexts({ contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT], documentUrls: [url] });
  if (contexts.length > 0) return;
  await chrome.offscreen.createDocument({
    url: OFFSCREEN_PATH,
    reasons: [chrome.offscreen.Reason.BLOBS],
    justification: 'Assemble downloaded stream segments into a single file on disk',
  });
}

async function command(message: OffscreenCommand): Promise<void> {
  await ensureOffscreen();
  await chrome.runtime.sendMessage(message).catch(() => undefined);
}

function notify(job: StreamJob, title: string, message: string): void {
  chrome.notifications?.create(`pkaf-stream-${job.id}`, {
    type: 'basic',
    iconUrl: chrome.runtime.getURL('icons/icon-128.png'),
    title,
    message,
  });
}

export async function startStreamJob(url: string, title: string, pageUrl: string): Promise<DownloadResult> {
  if (!chrome.downloads) return { ok: false, error: 'Turn on the video downloader in the extension settings' };
  let plan;
  try {
    plan = await resolveStream(url);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Could not read this stream' };
  }
  const job = await serial(async () => {
    const jobs = await readStreamJobs();
    if (jobs.some((item) => item.manifestUrl === plan.manifestUrl && ACTIVE_STREAM_STATES.has(item.state))) return null;
    const created = newStreamJob(crypto.randomUUID(), plan, title.trim() || 'video', pageUrl, new Date());
    await writeJobs([created, ...jobs]);
    return created;
  });
  if (!job) return { ok: false, error: 'This stream is already downloading' };
  watchStreamDownloads();
  await command({ target: 'offscreen', type: 'run', id: job.id, plan });
  return { ok: true };
}

async function saveTrack(event: Extract<OffscreenEvent, { type: 'stream-track-ready' }>): Promise<void> {
  const job = (await readStreamJobs()).find((item) => item.id === event.id);
  if (!job) return;
  const suffix = job.trackCount > 1 && event.index > 0 ? ' (audio)' : '';
  const downloadId = await chrome.downloads.download({
    url: event.url,
    filename: buildFilename(`${job.title}${suffix}`, event.extension),
    conflictAction: 'uniquify',
    saveAs: false,
  });
  await updateJob(event.id, (current) => {
    const downloadIds = [...current.downloadIds, downloadId];
    return { downloadIds, state: downloadIds.length >= current.trackCount ? 'saving' : current.state };
  });
}

export async function handleOffscreenEvent(event: OffscreenEvent): Promise<void> {
  if (event.type === 'stream-progress') {
    await updateJob(event.id, () => ({ done: event.done, bytes: event.bytes }));
    return;
  }
  if (event.type === 'stream-track-ready') {
    await saveTrack(event).catch(async (error) => {
      await updateJob(event.id, () => ({ state: 'failed', error: error instanceof Error ? error.message : 'Could not save the file' }));
      await command({ target: 'offscreen', type: 'cleanup', id: event.id });
    });
    return;
  }
  const job = await updateJob(event.id, () => ({ state: event.cancelled ? 'cancelled' : 'failed', error: event.error }));
  if (job && !event.cancelled) notify(job, 'Download failed', `${job.title}: ${event.error}`);
}

async function handleDownloadChange(delta: chrome.downloads.DownloadDelta): Promise<void> {
  const state = delta.state?.current;
  if (state !== 'complete' && state !== 'interrupted') return;
  const job = (await readStreamJobs()).find((item) => item.downloadIds.includes(delta.id));
  if (!job) return;
  if (state === 'interrupted') {
    await updateJob(job.id, () => ({ state: 'failed', error: 'Saving the file was interrupted' }));
    await command({ target: 'offscreen', type: 'cleanup', id: job.id });
    return;
  }
  const items = await Promise.all(job.downloadIds.map((id) => chrome.downloads.search({ id })));
  if (!items.every(([item]) => item?.state === 'complete')) return;
  const finished = await updateJob(job.id, () => ({ state: 'complete' }));
  await command({ target: 'offscreen', type: 'cleanup', id: job.id });
  if (finished) notify(finished, 'Download complete', finished.title);
}

export function watchStreamDownloads(): void {
  if (watching || !chrome.downloads) return;
  watching = true;
  chrome.downloads.onChanged.addListener((delta) => void handleDownloadChange(delta));
}

export async function controlStreamJob(id: string, action: StreamControl): Promise<{ ok: boolean }> {
  const job = (await readStreamJobs()).find((item) => item.id === id);
  if (!job) return { ok: false };
  if (action === 'pause' || action === 'resume') {
    await command({ target: 'offscreen', type: 'control', id, action });
    await updateJob(id, () => ({ state: action === 'pause' ? 'paused' : 'downloading' }));
    return { ok: true };
  }
  if (action === 'cancel') {
    await command({ target: 'offscreen', type: 'control', id, action: 'cancel' });
    await updateJob(id, () => ({ state: 'cancelled', error: 'Cancelled' }));
    return { ok: true };
  }
  if (ACTIVE_STREAM_STATES.has(job.state)) return { ok: false };
  if (action === 'retry') {
    const result = await startStreamJob(job.manifestUrl, job.title, job.pageUrl);
    if (!result.ok) return { ok: false };
  }
  await serial(async () => writeJobs((await readStreamJobs()).filter((item) => item.id !== id)));
  return { ok: true };
}

export async function failInterruptedJobs(): Promise<void> {
  await serial(async () => {
    const jobs = await readStreamJobs();
    for (const job of jobs) {
      if (ACTIVE_STREAM_STATES.has(job.state)) Object.assign(job, { state: 'failed', error: 'Browser closed during download' });
    }
    await writeJobs(jobs);
  });
}
