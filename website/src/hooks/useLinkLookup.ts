import { useCallback, useRef, useState } from 'react';
import { linkFrom } from '../core/link-input';
import { lookupErrorMessage } from '../core/media-api';

export type LinkLookupState<T> =
  | { phase: 'idle' }
  | { phase: 'looking'; url: string }
  | { phase: 'done'; result: T }
  | { phase: 'error'; message: string };

export function useLinkLookup<T>(find: (url: string) => Promise<T>) {
  const [state, setState] = useState<LinkLookupState<T>>({ phase: 'idle' });
  const latest = useRef(0);

  const lookup = useCallback(
    async (input: string) => {
      const url = linkFrom(input);
      if (!url) {
        setState({ phase: 'error', message: 'Paste a full video or page link, like https://example.com/video' });
        return;
      }
      const ticket = latest.current + 1;
      latest.current = ticket;
      setState({ phase: 'looking', url });
      try {
        const result = await find(url);
        if (ticket === latest.current) {
          setState({ phase: 'done', result });
        }
      } catch (error) {
        if (ticket === latest.current) {
          setState({ phase: 'error', message: lookupErrorMessage(error) });
        }
      }
    },
    [find],
  );

  return { state, lookup };
}
