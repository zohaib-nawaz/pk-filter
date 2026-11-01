import type { DisplayStatus } from './types';

export interface StatusMeta {
  label: string;
  color: string;
  description: string;
}

export const STATUS_META: Record<DisplayStatus, StatusMeta> = {
  accessible: { label: 'Accessible', color: '#188038', description: 'Loaded successfully from a Pakistani network' },
  blocked: { label: 'Blocked', color: '#d93025', description: 'Strong, corroborated evidence of network-level blocking' },
  possibly_blocked: { label: 'Possibly blocked', color: '#e37400', description: 'Suspicious DNS or connection behaviour, not confirmed' },
  unknown: { label: 'Unknown', color: '#80868b', description: 'No reliable measurement yet' },
  server_error: { label: 'Server error', color: '#80868b', description: 'The website itself returned an error; not a sign of blocking' },
  checking: { label: 'Checking…', color: '#bdc1c6', description: 'Measuring from Pakistan' },
};
