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
  if (!base || RESERVED.test(base)) {
    base = 'video';
  }
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

const MAX_TITLE_LENGTH = 100;
const GENERIC_LABELS = /^(download|download video|click here|here|link|shot link|video|play|watch|mp4|webm|open)$/i;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function cleanTitle(raw: string | null | undefined, siteName: string | null = null): string {
  let title = (raw ?? '').replace(/\s+/g, ' ').trim();
  if (siteName) {
    const site = escapeRegExp(siteName.trim());
    title = title
      .replace(new RegExp(`\\s*(?:[|\\-\u2013\u2014·•:]|\\bon\\b|\\bat\\b)\\s*${site}\\s*$`, 'i'), '')
      .replace(new RegExp(`^\\s*${site}\\s*[|\\-\u2013\u2014·•:]\\s*`, 'i'), '')
      .trim();
  }
  if (GENERIC_LABELS.test(title) || title.length < 2) {
    return '';
  }
  if (siteName && title.toLowerCase() === siteName.trim().toLowerCase()) {
    return '';
  }
  if (title.length <= MAX_TITLE_LENGTH) {
    return title;
  }
  const cut = title.slice(0, MAX_TITLE_LENGTH);
  const space = cut.lastIndexOf(' ');
  return (space > 40 ? cut.slice(0, space) : cut).trim();
}
