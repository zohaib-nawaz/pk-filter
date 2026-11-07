export type VideoPlatform = 'youtube' | 'vimeo' | 'dailymotion' | 'tiktok' | 'instagram' | 'facebook';

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const YOUTUBE_PATH = /^\/(?:shorts|embed|live|v|e)\/([A-Za-z0-9_-]{11})(?:[/?#]|$)/;
const PLATFORM_HOSTS: Array<[VideoPlatform, string[]]> = [
  ['youtube', ['youtube.com', 'youtu.be', 'youtube-nocookie.com']],
  ['vimeo', ['vimeo.com']],
  ['dailymotion', ['dailymotion.com', 'dai.ly']],
  ['tiktok', ['tiktok.com']],
  ['instagram', ['instagram.com']],
  ['facebook', ['facebook.com', 'fb.watch', 'fb.com']],
];

function onDomain(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

export function platformOf(url: URL): VideoPlatform | null {
  const host = url.hostname.toLowerCase();
  const match = PLATFORM_HOSTS.find(([, domains]) => domains.some((domain) => onDomain(host, domain)));
  if (!match) {
    return null;
  }
  return match[0];
}

export function youtubeId(url: URL): string | null {
  const host = url.hostname.toLowerCase();
  if (onDomain(host, 'youtu.be')) {
    const id = url.pathname.split('/').filter(Boolean)[0] || '';
    return YOUTUBE_ID.test(id) ? id : null;
  }
  const fromQuery = url.searchParams.get('v') || '';
  if (url.pathname === '/watch' && YOUTUBE_ID.test(fromQuery)) {
    return fromQuery;
  }
  const match = YOUTUBE_PATH.exec(url.pathname);
  return match ? (match[1] as string) : null;
}

export function isFacebookVideo(url: URL): boolean {
  if (onDomain(url.hostname.toLowerCase(), 'fb.watch')) {
    return true;
  }
  return /\/(?:videos|reel|reels|watch)(?:\/|$)/.test(url.pathname) || url.searchParams.has('v');
}
