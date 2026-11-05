import { useCallback, useEffect, useState } from 'react';
import { normalizeDomain } from '../../core/domain';
import { siteCardView, siteDomainFromUrl, type SiteCardView } from '../../core/site-view';
import type { SiteStatus } from '../../core/types';
import { sendRequest } from '../../shared/messaging';

export type SiteCardState =
  | { phase: 'loading' }
  | { phase: 'unsupported' }
  | { phase: 'unavailable'; domain: string }
  | { phase: 'ready'; view: SiteCardView };

async function activeDomain(): Promise<string | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const host = siteDomainFromUrl(tab?.url);
  return host ? normalizeDomain(host) : null;
}

export function useSiteStatus(preferredIsp: string | undefined) {
  const [site, setSite] = useState<SiteStatus | null>(null);
  const [phase, setPhase] = useState<'loading' | 'unsupported' | 'done'>('loading');

  const load = useCallback(async () => {
    setPhase('loading');
    const domain = await activeDomain();
    if (!domain) {
      setPhase('unsupported');
      return;
    }
    setSite((await sendRequest({ type: 'site-status', domain })) ?? { domain, result: null, history: null });
    setPhase('done');
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  let state: SiteCardState = { phase: 'loading' };
  if (phase === 'unsupported') {
    state = { phase: 'unsupported' };
  } else if (phase === 'done' && site) {
    const view = siteCardView(site, preferredIsp ?? '');
    state = view ? { phase: 'ready', view } : { phase: 'unavailable', domain: site.domain };
  }
  return { state, reload: load };
}
