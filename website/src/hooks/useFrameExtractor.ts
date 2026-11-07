import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { averageFrameBytes, CaptureError, captureErrorMessage, captureFrame, isAbort, openVideo, releaseVideo, saveBlob, seekTo } from '../core/frame-capture';
import { DEFAULT_NAMING, nameFrames, type NameSettings } from '../core/frame-names';
import { archiveName, defaultSettings, outputSize, planFrames, sampleKey, sampleTimes, type FrameSettings } from '../core/frames';
import { linkFrom } from '../core/link-input';
import { lookupErrorMessage, lookupVideo, type VideoLookup } from '../core/media-api';
import { makeZip } from '../core/zip';

export interface FrameVideo {
  title: string;
  duration: number;
  width: number;
  height: number;
  src: string;
  crossOrigin: boolean;
}

export interface Frame {
  index: number;
  time: number;
  type: string;
  url: string;
  blob: Blob;
}

export interface FrameOutput {
  width: number;
  height: number;
  fps: number | null;
}

export type FrameState =
  | { phase: 'empty' }
  | { phase: 'loading'; message: string }
  | { phase: 'ready'; video: FrameVideo }
  | { phase: 'extracting'; video: FrameVideo; done: number; total: number }
  | { phase: 'done'; video: FrameVideo; frames: Frame[]; output: FrameOutput; capped: boolean; cancelled: boolean }
  | { phase: 'error'; message: string; video: FrameVideo | null };

const VIDEO_FILE = /\.(mp4|m4v|webm|mov|mkv|ogv|3gp)$/i;
const NO_FILE = 'This link has no video file the browser can open. Download the video first, then open the file here.';
const SAMPLE_DELAY_MS = 400;
const ZIP_FAILED = 'The ZIP file could not be made, most likely because the frames are too large. Save the frames one by one or pick a smaller size.';

function videoOf(state: FrameState): FrameVideo | null {
  if (state.phase === 'empty' || state.phase === 'loading') {
    return null;
  }
  return state.video;
}

interface Sampling {
  controller: AbortController;
  done: Promise<void>;
}

function canvasFor(video: FrameVideo, settings: FrameSettings): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  const size = outputSize(video.width, video.height, settings.maxHeight);
  canvas.width = size.width;
  canvas.height = size.height;
  return canvas;
}

function revokeAll(frames: Frame[]): void {
  for (const frame of frames) {
    URL.revokeObjectURL(frame.url);
  }
}

export function useFrameExtractor() {
  const [state, setState] = useState<FrameState>({ phase: 'empty' });
  const [settings, setSettings] = useState<FrameSettings | null>(null);
  const [zipping, setZipping] = useState(false);
  const [zipError, setZipError] = useState<string | null>(null);
  const [naming, setNaming] = useState<NameSettings>(DEFAULT_NAMING);
  const [sample, setSample] = useState<{ key: string; bytes: number } | null>(null);
  const sampling = useRef<Sampling | null>(null);
  const element = useRef<HTMLVideoElement | null>(null);
  const fileUrl = useRef<string | null>(null);
  const frames = useRef<Frame[]>([]);
  const running = useRef<AbortController | null>(null);
  const latest = useRef(0);

  const release = useCallback(() => {
    running.current?.abort();
    revokeAll(frames.current);
    frames.current = [];
    releaseVideo(element.current);
    element.current = null;
    if (fileUrl.current) {
      URL.revokeObjectURL(fileUrl.current);
      fileUrl.current = null;
    }
  }, []);

  useEffect(() => release, [release]);

  const open = useCallback(
    async (load: () => Promise<{ src: string; title: string; crossOrigin: boolean }>) => {
      const ticket = latest.current + 1;
      latest.current = ticket;
      release();
      setSettings(null);
      setSample(null);
      setState({ phase: 'loading', message: 'Opening the video…' });
      try {
        const source = await load();
        const video = await openVideo(source.src, source.crossOrigin);
        if (ticket !== latest.current) {
          releaseVideo(video);
          return;
        }
        element.current = video;
        const info = { title: source.title, duration: video.duration, width: video.videoWidth, height: video.videoHeight, src: source.src, crossOrigin: source.crossOrigin };
        setSettings(defaultSettings(video.duration));
        setState({ phase: 'ready', video: info });
      } catch (error) {
        if (ticket === latest.current) {
          setState({ phase: 'error', message: captureErrorMessage(error), video: null });
        }
      }
    },
    [release],
  );

  const openFile = useCallback(
    (file: File) => {
      if (!file.type.startsWith('video/') && !VIDEO_FILE.test(file.name)) {
        setState({ phase: 'error', message: 'Pick a video file, like MP4, WebM or MOV.', video: null });
        return;
      }
      void open(async () => {
        const src = URL.createObjectURL(file);
        fileUrl.current = src;
        return { src, title: file.name, crossOrigin: false };
      });
    },
    [open],
  );

  const openLink = useCallback(
    (input: string) => {
      const url = linkFrom(input);
      if (!url) {
        setState({ phase: 'error', message: 'Paste a full video or page link, like https://example.com/video.mp4', video: null });
        return;
      }
      void open(async () => {
        let lookup: VideoLookup;
        try {
          lookup = await lookupVideo(url);
        } catch (error) {
          throw new CaptureError(lookupErrorMessage(error));
        }
        if (!lookup.preview.mediaUrl || lookup.preview.audioOnly) {
          throw new CaptureError(NO_FILE);
        }
        return { src: lookup.preview.mediaUrl, title: lookup.title, crossOrigin: true };
      });
    },
    [open],
  );

  const readyVideo = state.phase === 'ready' ? state.video : null;
  const currentKey = settings ? sampleKey(settings) : null;

  useEffect(() => {
    const video = element.current;
    if (!readyVideo || !video || !settings || !currentKey || sample?.key === currentKey) {
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      const done = averageFrameBytes(video, sampleTimes(readyVideo.duration), canvasFor(readyVideo, settings), settings.format, settings.quality, controller.signal)
        .then((bytes) => setSample({ key: currentKey, bytes }))
        .catch(() => undefined);
      sampling.current = { controller, done };
    }, SAMPLE_DELAY_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [readyVideo, currentKey]);

  const bytesPerFrame = sample && sample.key === currentKey ? sample.bytes : null;

  const extract = useCallback(async () => {
    const video = element.current;
    const info = videoOf(state);
    if (!video || !info || !settings || state.phase === 'extracting') {
      return;
    }
    sampling.current?.controller.abort();
    await sampling.current?.done;
    revokeAll(frames.current);
    frames.current = [];
    setZipError(null);
    const plan = planFrames(settings, info.duration);
    const controller = new AbortController();
    running.current = controller;
    const canvas = canvasFor(info, settings);
    const output = { width: canvas.width, height: canvas.height, fps: settings.spacing === 'rate' ? settings.fps : null };
    const collected: Frame[] = [];
    setState({ phase: 'extracting', video: info, done: 0, total: plan.times.length });
    try {
      for (const [index, time] of plan.times.entries()) {
        await seekTo(video, time, controller.signal);
        const blob = await captureFrame(video, canvas, settings.format, settings.quality);
        collected.push({ index, time, type: blob.type, blob, url: URL.createObjectURL(blob) });
        setState({ phase: 'extracting', video: info, done: index + 1, total: plan.times.length });
      }
      frames.current = collected;
      setState({ phase: 'done', video: info, frames: collected, output, capped: plan.capped, cancelled: false });
    } catch (error) {
      frames.current = collected;
      if (isAbort(error)) {
        setState({ phase: 'done', video: info, frames: collected, output, capped: plan.capped, cancelled: true });
        return;
      }
      revokeAll(collected);
      frames.current = [];
      setState({ phase: 'error', message: captureErrorMessage(error), video: info });
    } finally {
      running.current = null;
    }
  }, [settings, state]);

  const cancel = useCallback(() => {
    running.current?.abort();
  }, []);

  const names = useMemo(() => {
    if (state.phase !== 'done') {
      return [];
    }
    return nameFrames(state.frames, naming, { title: state.video.title, ...state.output, date: new Date() });
  }, [state, naming]);

  const downloadAll = useCallback(async () => {
    if (state.phase !== 'done' || state.frames.length === 0) {
      return;
    }
    setZipping(true);
    setZipError(null);
    try {
      const entries = state.frames.map((frame, index) => ({ name: names[index] as string, data: frame.blob }));
      saveBlob(await makeZip(entries), archiveName(state.video.title));
    } catch {
      setZipError(ZIP_FAILED);
    } finally {
      setZipping(false);
    }
  }, [state, names]);

  const backToSettings = useCallback(() => {
    const info = videoOf(state);
    if (info) {
      setState({ phase: 'ready', video: info });
    }
  }, [state]);

  const reset = useCallback(() => {
    latest.current += 1;
    release();
    setSettings(null);
    setState({ phase: 'empty' });
  }, [release]);

  return { state, settings, setSettings, naming, setNaming, names, bytesPerFrame, zipping, zipError, openFile, openLink, extract, cancel, downloadAll, backToSettings, reset };
}
