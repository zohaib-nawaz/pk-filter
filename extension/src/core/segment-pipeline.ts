export class SegmentError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

export type SegmentChunk = Uint8Array<ArrayBuffer>;

export interface SegmentPipeline<T> {
  items: T[];
  concurrency: number;
  attempts: number;
  signal: AbortSignal;
  fetchSegment: (item: T, signal: AbortSignal) => Promise<SegmentChunk>;
  write: (chunk: SegmentChunk) => Promise<void>;
  waitIfPaused: () => Promise<void>;
  onSegment: (bytes: number) => void;
  delay?: (ms: number) => Promise<void>;
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function fetchWithRetry<T>(item: T, pipeline: SegmentPipeline<T>): Promise<SegmentChunk> {
  const delay = pipeline.delay ?? wait;
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await pipeline.fetchSegment(item, pipeline.signal);
    } catch (error) {
      const retryable = !(error instanceof SegmentError) || error.retryable;
      if (pipeline.signal.aborted || !retryable || attempt >= pipeline.attempts) throw error;
      await delay(500 * 2 ** (attempt - 1));
    }
  }
}

export async function runSegments<T>(pipeline: SegmentPipeline<T>): Promise<void> {
  const pending = new Map<number, Promise<SegmentChunk>>();
  let next = 0;
  const launch = () => {
    while (pending.size < pipeline.concurrency && next < pipeline.items.length) {
      const index = next;
      const task = fetchWithRetry(pipeline.items[index] as T, pipeline);
      task.catch(() => undefined);
      pending.set(index, task);
      next += 1;
    }
  };

  for (let index = 0; index < pipeline.items.length; index += 1) {
    await pipeline.waitIfPaused();
    if (pipeline.signal.aborted) throw new SegmentError('Cancelled', false);
    launch();
    const chunk = await (pending.get(index) as Promise<SegmentChunk>);
    pending.delete(index);
    await pipeline.write(chunk);
    pipeline.onSegment(chunk.byteLength);
  }
}
