import { useCallback, useEffect, useState } from 'react';
import type { Settings } from '../../core/types';
import { loadSettings, onSettingsChanged, saveSettings, type SettingsUpdate } from '../../shared/storage';

export function useSettings() {
  const [settings, setSettings] = useState<Settings | null>(null);

  useEffect(() => {
    void loadSettings().then(setSettings);
    return onSettingsChanged(setSettings);
  }, []);

  const update = useCallback(async (patch: SettingsUpdate) => {
    setSettings(await saveSettings(patch));
  }, []);

  return { settings, update };
}
