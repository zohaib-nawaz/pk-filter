const UNITS: Array<[number, string]> = [
  [86_400_000, 'day'],
  [3_600_000, 'hour'],
  [60_000, 'minute'],
];

export function formatRelative(iso: string | null, now: number = Date.now()): string {
  if (!iso) {
    return 'Never';
  }
  const elapsed = now - Date.parse(iso);
  if (!Number.isFinite(elapsed)) {
    return 'Never';
  }
  if (elapsed < 60_000) {
    return 'Just now';
  }
  for (const [size, unit] of UNITS) {
    if (elapsed >= size) {
      const count = Math.floor(elapsed / size);
      return `${count} ${unit}${count === 1 ? '' : 's'} ago`;
    }
  }
  return 'Just now';
}

export function formatConfidence(confidence: number): string {
  if (confidence >= 0.85) {
    return `High (${Math.round(confidence * 100)}%)`;
  }
  if (confidence >= 0.6) {
    return `Medium (${Math.round(confidence * 100)}%)`;
  }
  return `Low (${Math.round(confidence * 100)}%)`;
}

export function formatNetwork(network: { isp: string; asn: string } | null): string {
  if (!network) {
    return 'Unknown network';
  }
  const parts = [network.isp, network.asn].filter((part) => part && part !== 'unknown');
  return parts.length ? parts.join(' · ') : 'Unknown network';
}
