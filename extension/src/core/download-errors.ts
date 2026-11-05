const INTERRUPT_MESSAGES: Record<string, string> = {
  FILE_NO_SPACE: 'Not enough disk space',
  FILE_ACCESS_DENIED: 'Chrome could not write to the downloads folder',
  FILE_NAME_TOO_LONG: 'File name is too long',
  FILE_TOO_LARGE: 'File is too large for the disk',
  FILE_FAILED: 'Could not save the file',
  FILE_BLOCKED: 'Blocked by browser or system security settings',
  FILE_SECURITY_CHECK_FAILED: 'Blocked by a security check',
  NETWORK_FAILED: 'Network error, check your connection',
  NETWORK_TIMEOUT: 'Network timed out',
  NETWORK_DISCONNECTED: 'Internet connection was lost',
  NETWORK_SERVER_DOWN: 'The video server is down',
  NETWORK_INVALID_REQUEST: 'Invalid download request',
  SERVER_FAILED: 'The video server returned an error',
  SERVER_NO_RANGE: 'Server does not support resuming',
  SERVER_BAD_CONTENT: 'Video not found on the server',
  SERVER_UNAUTHORIZED: 'This video needs you to sign in',
  SERVER_CERT_PROBLEM: 'Server certificate problem',
  SERVER_FORBIDDEN: 'Access denied or the link has expired',
  SERVER_UNREACHABLE: 'Video server is unreachable',
  SERVER_CONTENT_LENGTH_MISMATCH: 'Download was incomplete',
  USER_CANCELED: 'Cancelled',
  USER_SHUTDOWN: 'Browser closed during download',
  CRASH: 'Browser crashed during download',
};

export function describeInterrupt(reason: string | undefined): string | null {
  if (!reason) {
    return null;
  }
  return INTERRUPT_MESSAGES[reason] ?? 'Download failed';
}

export function formatBytes(bytes: number | null): string {
  if (bytes === null || bytes <= 0) {
    return 'Unknown size';
  }
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}
