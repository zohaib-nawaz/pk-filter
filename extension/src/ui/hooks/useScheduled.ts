import { useCallback, useEffect, useState } from 'react';
import type { ScheduledDownload } from '../../core/types';
import { sendRequest } from '../../shared/messaging';
import { onScheduledChanged, readScheduled } from '../../shared/night-client';

export function useScheduled() {
  const [items, setItems] = useState<ScheduledDownload[]>([]);

  const load = useCallback(async () => {
    setItems(await readScheduled());
  }, []);

  useEffect(() => {
    void load();
    return onScheduledChanged(() => void load());
  }, [load]);

  const cancel = useCallback(async (id: string) => {
    await sendRequest({ type: 'unschedule-download', id });
  }, []);

  return { items, cancel };
}
