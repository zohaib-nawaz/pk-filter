const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;
const TLD = /^(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/;

function hostOf(input: string): string | null {
  const raw = input.trim();
  if (!raw) {
    return null;
  }
  try {
    const url = new URL(raw.includes('://') ? raw : `https://${raw}`);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return null;
    }
    return url.hostname;
  } catch {
    return null;
  }
}

export function domainFromInput(input: string): string | null {
  const host = hostOf(input);
  if (!host) {
    return null;
  }
  const domain = host.toLowerCase().replace(/\.$/, '').replace(/^www\./, '');
  const labels = domain.split('.');
  const tld = labels.at(-1);
  if (labels.length < 2 || !tld || !TLD.test(tld) || !labels.every((label) => LABEL.test(label))) {
    return null;
  }
  return domain;
}
