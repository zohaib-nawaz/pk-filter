import { useCallback } from 'react';
import type { Settings } from '../../core/types';
import { FAILURE_HELPER_PERMISSIONS } from '../../shared/permissions';
import type { SettingsUpdate } from '../../shared/storage';
import { usePermissionToggle } from './usePermissionToggle';

export function useFailureHelper(settings: Settings | null, update: (patch: SettingsUpdate) => Promise<void>) {
  const save = useCallback((explainFailures: boolean) => update({ explainFailures }), [update]);
  return usePermissionToggle({ enabled: settings ? settings.explainFailures : false, permissions: FAILURE_HELPER_PERMISSIONS, save });
}
