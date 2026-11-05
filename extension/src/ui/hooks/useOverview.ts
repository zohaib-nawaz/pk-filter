import { useCallback, useEffect, useState } from 'react';
import { overviewFrom } from '../../core/overview';
import type { OverviewStats } from '../../core/types';
import { sendRequest } from '../../shared/messaging';

export function useOverview() {
  const [overview, setOverview] = useState<OverviewStats | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    setOverview(overviewFrom(await sendRequest({ type: 'overview' })));
  }, []);

  const run = useCallback(
    async (type: 'refresh' | 'clear-cache') => {
      setBusy(true);
      await sendRequest({ type });
      await reload();
      setBusy(false);
    },
    [reload],
  );

  useEffect(() => {
    void reload();
  }, [reload]);

  return {
    overview,
    busy,
    refresh: () => run('refresh'),
    clearCache: () => run('clear-cache'),
  };
}
