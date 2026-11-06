import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const brand = JSON.parse(readFileSync(resolve(import.meta.dirname, 'brand.json'), 'utf8'));

const TOKENS = {
  '%BRAND_NAME%': brand.name,
  '%BRAND_TAGLINE%': brand.tagline,
  '%BRAND_DESCRIPTION%': brand.description,
};

export function applyBrand(text) {
  return Object.entries(TOKENS).reduce((result, [token, value]) => result.replaceAll(token, value), text);
}

export function brandHtml() {
  return { name: 'brand-html', transformIndexHtml: (html) => applyBrand(html) };
}
