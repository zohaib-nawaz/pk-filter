import { useCallback, useEffect, useState } from 'react';
import { normalizeDomain } from '../../core/domain';
import { domainFromUrl, siteCardView, type SiteCardView } from '../../core/site-view';
import type { SiteStatus } from '../../core/types';
import { sendRequest } from '../../shared/messaging';

export type SiteCardState =
  | { phase: 'loading' }
  | { phase: 'unsupported' }
  | { phase: 'unavailable'; domain: string }
  | { phase: 'ready'; view: SiteCardView };

async function activeDomain(): Promise<string | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) {
    return null;
  }
  return domainFromUrl(tab.url);
}

async function fixedOrActive(fixedDomain: string | undefined): Promise<string | null> {
  if (fixedDomain === undefined) {
    return activeDomain();
  }
  return normalizeDomain(fixedDomain);
}

export function useSiteStatus(preferredIsp: string | undefined, fixedDomain?: string) {
  const [site, setSite] = useState<SiteStatus | null>(null);
  const [phase, setPhase] = useState<'loading' | 'unsupported' | 'done'>('loading');

  const load = useCallback(async () => {
    setPhase('loading');
    const domain = await fixedOrActive(fixedDomain);
    if (!domain) {
      setPhase('unsupported');
      return;
    }
    setSite((await sendRequest({ type: 'site-status', domain })) ?? { domain, result: null, history: null });
    setPhase('done');
  }, [fixedDomain]);

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
