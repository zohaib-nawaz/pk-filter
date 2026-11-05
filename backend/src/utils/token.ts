import { timingSafeEqual } from 'node:crypto';

export function sameToken(given: unknown, expected: string): boolean {
  if (typeof given !== 'string' || expected.length === 0) {
    return false;
  }
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
