const COUNTRY = /^[A-Z]{2}$/;
const NOT_COUNTRIES = new Set(['XX', 'T1', 'ZZ', 'EU', 'AP']);

export function countryCode(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const code = value.trim().toUpperCase();
  if (!COUNTRY.test(code) || NOT_COUNTRIES.has(code)) {
    return null;
  }
  return code;
}
