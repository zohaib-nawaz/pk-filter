import { useCallback, useRef, useState } from 'react';
import { CheckError, checkSite } from '../core/check-api';
import { checkView, type CheckView } from '../core/check-view';
import { domainFromInput } from '../core/domain-input';

export type SiteCheckState =
  | { phase: 'idle' }
  | { phase: 'checking'; domain: string }
  | { phase: 'done'; view: CheckView }
  | { phase: 'error'; message: string };

function messageOf(error: unknown): string {
  if (error instanceof CheckError) {
    return error.message;
  }
  return 'Something went wrong. Try again.';
}

export function useSiteCheck() {
  const [state, setState] = useState<SiteCheckState>({ phase: 'idle' });
  const latest = useRef(0);

  const check = useCallback(async (input: string, country: string) => {
    const domain = domainFromInput(input);
    if (!domain) {
      setState({ phase: 'error', message: 'Enter a website like example.com' });
      return;
    }
    const ticket = latest.current + 1;
    latest.current = ticket;
    setState({ phase: 'checking', domain });
    try {
      const view = checkView(await checkSite(domain, country));
      if (ticket !== latest.current) {
        return;
      }
      if (!view) {
        setState({ phase: 'error', message: `No result came back for ${domain}.` });
        return;
      }
      setState({ phase: 'done', view });
    } catch (error) {
      if (ticket === latest.current) {
        setState({ phase: 'error', message: messageOf(error) });
      }
    }
  }, []);

  return { state, check };
}
