import brandFile from '../../../brand/brand.json';

export interface Brand {
  name: string;
  slug: string;
  tagline: string;
  description: string;
  addonId: string;
}

export const BRAND: Brand = brandFile;

export function brandId(name: string): string {
  return `${BRAND.slug}-${name}`;
}
