import { useCallback, useRef, useState } from 'react';
import { LookupError, lookupVideo, type VideoLookup } from '../core/media-api';

export type VideoLookupState =
  | { phase: 'idle' }
  | { phase: 'looking'; url: string }
  | { phase: 'done'; lookup: VideoLookup }
  | { phase: 'error'; message: string };

const HOST = /^(?:[a-z0-9-]+\.)+[a-z0-9-]{2,}$|^\[[0-9a-f:]+\]$/i;

function linkFrom(input: string): string | null {
  const raw = input.trim();
  if (!raw) {
    return null;
  }
  try {
    const url = new URL(raw.includes('://') ? raw : `https://${raw}`);
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !HOST.test(url.hostname)) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

function messageOf(error: unknown): string {
  if (error instanceof LookupError) {
    return error.message;
  }
  return 'Something went wrong. Try again.';
}

export function useVideoLookup() {
  const [state, setState] = useState<VideoLookupState>({ phase: 'idle' });
  const latest = useRef(0);

  const lookup = useCallback(async (input: string) => {
    const url = linkFrom(input);
    if (!url) {
      setState({ phase: 'error', message: 'Paste a full video or page link, like https://example.com/video' });
      return;
    }
    const ticket = latest.current + 1;
    latest.current = ticket;
    setState({ phase: 'looking', url });
    try {
      const result = await lookupVideo(url);
      if (ticket === latest.current) {
        setState({ phase: 'done', lookup: result });
      }
    } catch (error) {
      if (ticket === latest.current) {
        setState({ phase: 'error', message: messageOf(error) });
      }
    }
  }, []);

  return { state, lookup };
}
