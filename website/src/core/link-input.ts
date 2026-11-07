const HOST = /^(?:[a-z0-9-]+\.)+[a-z0-9-]{2,}$|^\[[0-9a-f:]+\]$/i;

export function linkFrom(input: string): string | null {
  const raw = input.trim();
  if (!raw) {
    return null;
  }
  try {
    const url = new URL(raw.includes('://') ? raw : `https://${raw}`);
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !HOST.test(url.hostname)) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}
