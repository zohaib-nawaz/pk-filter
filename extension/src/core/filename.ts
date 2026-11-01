const ILLEGAL = /[\u0000-\u001f\u007f<>:"/\\|?*]+/g;
const RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)$/i;
const MAX_BASE_LENGTH = 120;

export function buildFilename(title: string, extension: string): string {
  const safeExtension = extension.toLowerCase().replace(/[^a-z0-9]/g, '') || 'mp4';
  let base = title
    .normalize('NFKC')
    .replace(ILLEGAL, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s.]+|[\s.]+$/g, '')
    .slice(0, MAX_BASE_LENGTH)
    .trim();
  base = base.replace(new RegExp(`\\.${safeExtension}$`, 'i'), '');
  if (!base || RESERVED.test(base)) base = 'video';
  return `${base}.${safeExtension}`;
}

export function titleFromUrl(url: string): string {
  try {
    const last = new URL(url).pathname.split('/').filter(Boolean).at(-1) ?? '';
    return decodeURIComponent(last).replace(/\.[a-z0-9]{2,5}$/i, '') || 'video';
  } catch {
    return 'video';
  }
}
