import { useEffect, useState } from 'react';
import { hasPermissions, removePermissions, requestPermissions, type PermissionSet } from '../../shared/permissions';

interface PermissionToggle {
  enabled: boolean;
  permissions: PermissionSet;
  save: (enabled: boolean) => Promise<void>;
  refusedSuffix?: string;
  afterChange?: () => Promise<unknown>;
}

export function usePermissionToggle({ enabled, permissions, save, refusedSuffix = '', afterChange }: PermissionToggle) {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    void hasPermissions(permissions).then((granted) => {
      if (!granted) {
        void save(false);
      }
    });
  }, [enabled, permissions, save]);

  const finish = async () => {
    if (afterChange) {
      await afterChange();
    }
  };

  const setEnabled = async (next: boolean) => {
    setError(null);
    if (!next) {
      await save(false);
      await removePermissions(permissions);
      await finish();
      return;
    }
    const permission = await requestPermissions(permissions);
    if (!permission.granted) {
      setError(`${permission.error}${refusedSuffix}`);
      return;
    }
    await save(true);
    await finish();
  };

  return { setEnabled, error };
}
