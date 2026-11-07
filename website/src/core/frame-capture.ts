import type { FrameFormat } from './frames';

export class CaptureError extends Error {}

const LOAD_TIMEOUT_MS = 45_000;
const SEEK_TIMEOUT_MS = 15_000;

export function waitForEvent(target: HTMLMediaElement, name: 'loadedmetadata' | 'seeked', timeoutMs: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      window.clearTimeout(timer);
      target.removeEventListener(name, done);
      target.removeEventListener('error', failed);
      signal?.removeEventListener('abort', aborted);
    };
    const done = () => {
      cleanup();
      resolve();
    };
    const failed = () => {
      cleanup();
      reject(new CaptureError('This video could not be opened in the browser. MP4 and WebM files work best.'));
    };
    const aborted = () => {
      cleanup();
      reject(new DOMException('Cancelled', 'AbortError'));
    };
    const timer = window.setTimeout(() => {
      cleanup();
      reject(new CaptureError('The video took too long to respond. Try again or use a smaller file.'));
    }, timeoutMs);
    target.addEventListener(name, done, { once: true });
    target.addEventListener('error', failed, { once: true });
    signal?.addEventListener('abort', aborted, { once: true });
  });
}

export async function openVideo(src: string, crossOrigin: boolean): Promise<HTMLVideoElement> {
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  if (crossOrigin) {
    video.crossOrigin = 'anonymous';
  }
  const loaded = waitForEvent(video, 'loadedmetadata', LOAD_TIMEOUT_MS);
  video.src = src;
  await loaded;
  if (!video.videoWidth || !video.videoHeight) {
    throw new CaptureError('This file has no picture, only sound.');
  }
  if (!Number.isFinite(video.duration) || video.duration <= 0) {
    throw new CaptureError('The length of this video is unknown, so frames cannot be picked from it.');
  }
  return video;
}

export async function seekTo(video: HTMLVideoElement, time: number, signal: AbortSignal): Promise<void> {
  if (Math.abs(video.currentTime - time) < 0.0005 && !video.seeking && video.readyState >= 2) {
    return;
  }
  const seeked = waitForEvent(video, 'seeked', SEEK_TIMEOUT_MS, signal);
  video.currentTime = time;
  await seeked;
}

function toBlob(canvas: HTMLCanvasElement, format: FrameFormat, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob(
        (blob) => {
          if (blob) {
            resolve(blob);
            return;
          }
          reject(new CaptureError('The browser could not save this frame.'));
        },
        format,
        quality,
      );
    } catch {
      reject(new CaptureError('This website does not allow reading the video picture. Download the video and open the file instead.'));
    }
  });
}

export async function captureFrame(video: HTMLVideoElement, canvas: HTMLCanvasElement, format: FrameFormat, quality: number): Promise<Blob> {
  const context = canvas.getContext('2d');
  if (!context) {
    throw new CaptureError('This browser cannot draw video frames.');
  }
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  return toBlob(canvas, format, quality);
}

export async function averageFrameBytes(video: HTMLVideoElement, times: number[], canvas: HTMLCanvasElement, format: FrameFormat, quality: number, signal: AbortSignal): Promise<number> {
  let total = 0;
  for (const time of times) {
    await seekTo(video, time, signal);
    total += (await captureFrame(video, canvas, format, quality)).size;
  }
  return total / Math.max(times.length, 1);
}

export function releaseVideo(video: HTMLVideoElement | null): void {
  if (!video) {
    return;
  }
  video.removeAttribute('src');
  video.load();
}

export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function captureErrorMessage(error: unknown): string {
  if (error instanceof CaptureError) {
    return error.message;
  }
  return 'Something went wrong while reading the video. Try again.';
}

export function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}
