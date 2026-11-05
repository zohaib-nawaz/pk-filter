import type { CheckResult, DisplayStatus, Settings } from './types';

const UNMEASURED_EVIDENCE = new Set(['service_unavailable', 'still_checking', 'server_busy']);

export function isMeasured(result: CheckResult | null): boolean {
  if (!result) {
    return false;
  }
  return !result.evidence.some((code) => UNMEASURED_EVIDENCE.has(code));
}

export function isHidden(status: DisplayStatus, settings: Settings): boolean {
  if (!settings.enabled || settings.filterMode === 'all' || status === 'checking') {
    return false;
  }
  if (status === 'blocked') {
    return true;
  }
  if (status === 'possibly_blocked') {
    return settings.filterMode === 'only_accessible';
  }
  if (status === 'unknown' || status === 'server_error') {
    return !settings.showUnknown;
  }
  return false;
}
