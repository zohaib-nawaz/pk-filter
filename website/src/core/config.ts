function setting(value: string | undefined, fallback: string): string {
  if (!value) {
    return fallback;
  }
  return value.replace(/\/+$/, '');
}

export const API_URL = setting(import.meta.env.VITE_API_URL, 'http://localhost:8787');
export const REPO_URL = setting(import.meta.env.VITE_REPO_URL, 'https://github.com/zohaib-nawaz/pk-filter');
export const RELEASES_URL = `${REPO_URL}/releases`;
export const ISSUES_URL = `${REPO_URL}/issues`;
