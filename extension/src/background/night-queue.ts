import { brandId } from '../core/brand';
import { errorMessage } from '../core/errors';
import { createLimiter } from '../core/limiter';
import type { DownloadResult, ScheduleResult } from '../core/messages';
import { inNightWindow, nextNightStart } from '../core/night';
import type { DownloadOptions, ScheduledDownload } from '../core/types';
import { NIGHT_QUEUE_KEY, readScheduled } from '../shared/night-client';
import { loadSettings } from '../shared/storage';

const ALARM = brandId('night-downloads');
const MAX_QUEUE = 50;
const queue = createLimiter(1);
let watching = false;
let running = false;
let starter: Starter | null = null;

type Starter = (url: string, title: string, pageUrl: string | undefined, options: DownloadOptions) => Promise<DownloadResult>;
type NewItem = Omit<ScheduledDownload, 'id' | 'addedAt' | 'error'>;

function locked<T>(change: (items: ScheduledDownload[]) => { items: ScheduledDownload[]; result: T }): Promise<T> {
  return queue(async () => {
    const { items, result } = change(await readScheduled());
    await chrome.storage.local.set({ [NIGHT_QUEUE_KEY]: items.slice(-MAX_QUEUE) });
    return result;
  });
}

function pending(items: ScheduledDownload[]): ScheduledDownload[] {
  return items.filter((item) => !item.error);
}

async function scheduleAlarm(): Promise<void> {
  if (!chrome.alarms) {
    return;
  }
  if (pending(await readScheduled()).length === 0) {
    await chrome.alarms.clear(ALARM);
    return;
  }
  const settings = await loadSettings();
  await chrome.alarms.create(ALARM, { when: nextNightStart(new Date(), settings.nightStartHour).getTime() });
}

async function inWindowNow(): Promise<boolean> {
  const settings = await loadSettings();
  return inNightWindow(new Date(), settings.nightStartHour, settings.nightEndHour);
}

function newest<T>(items: T[], count: number): T[] {
  if (count <= 0) {
    return [];
  }
  return items.slice(-count);
}

function addItem(items: ScheduledDownload[], item: NewItem): { items: ScheduledDownload[]; result: string | null } {
  if (items.some((entry) => entry.url === item.url && entry.audioOnly === item.audioOnly && !entry.error)) {
    return { items, result: 'Already scheduled for tonight' };
  }
  if (pending(items).length >= MAX_QUEUE) {
    return { items, result: `You can schedule up to ${MAX_QUEUE} downloads` };
  }
  const added: ScheduledDownload = { ...item, id: crypto.randomUUID(), addedAt: new Date().toISOString() };
  const others = items.filter((entry) => !(entry.url === item.url && entry.audioOnly === item.audioOnly));
  const waiting = pending(others);
  const failed = newest(others.filter((entry) => entry.error), MAX_QUEUE - waiting.length - 1);
  return { items: [...waiting, ...failed, added], result: null };
}

export async function scheduleDownload(item: NewItem): Promise<ScheduleResult> {
  const problem = await locked((items) => addItem(items, item));
  if (problem) {
    return { ok: false, error: problem };
  }
  await scheduleAlarm();
  const startsNow = await inWindowNow();
  if (startsNow && starter) {
    void runQueue(starter).catch(() => undefined);
  }
  return { ok: true, startsNow };
}

export async function unscheduleDownload(id: string): Promise<void> {
  await locked((items) => ({ items: items.filter((item) => item.id !== id), result: null }));
  await scheduleAlarm();
}

function settle(id: string, failure: ScheduledDownload | null): Promise<void> {
  return locked((items) => {
    if (!failure) {
      return { items: items.filter((item) => item.id !== id), result: undefined };
    }
    return { items: items.map((item) => (item.id === id ? failure : item)), result: undefined };
  });
}

async function startItem(start: Starter, item: ScheduledDownload): Promise<ScheduledDownload | null> {
  const pageUrl = item.pageUrl === null ? undefined : item.pageUrl;
  try {
    const result = await start(item.url, item.title, pageUrl, { audioOnly: item.audioOnly });
    if (result.ok) {
      return null;
    }
    return { ...item, error: result.error };
  } catch (error) {
    return { ...item, error: errorMessage(error, 'Could not start the download') };
  }
}

async function runQueue(start: Starter): Promise<void> {
  if (running) {
    return;
  }
  if (!(await inWindowNow())) {
    await scheduleAlarm();
    return;
  }
  running = true;
  try {
    let next = pending(await readScheduled());
    while (next.length > 0) {
      for (const item of next) {
        await settle(item.id, await startItem(start, item));
      }
      next = pending(await readScheduled());
    }
  } finally {
    running = false;
  }
  await scheduleAlarm();
}

export function watchNightQueue(start: Starter): void {
  if (watching || !chrome.alarms) {
    return;
  }
  watching = true;
  starter = start;
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === ALARM) {
      void runQueue(start).catch(() => undefined);
    }
  });
  void runQueue(start).catch(() => undefined);
}

export function rescheduleNightQueue(): void {
  if (starter) {
    void runQueue(starter).catch(() => undefined);
    return;
  }
  void scheduleAlarm().catch(() => undefined);
}
