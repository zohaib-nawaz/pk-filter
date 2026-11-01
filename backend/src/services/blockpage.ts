const FINGERPRINTS: RegExp[] = [
  /not allowed for viewing from within pakistan/i,
  /surf safely[\s\S]{0,400}pakistan/i,
  /blocked[\s\S]{0,120}(?:pakistan telecommunication authority|\bpta\b)/i,
];

export function detectBlockpage(body: string): boolean {
  return body.length > 0 && FINGERPRINTS.some((pattern) => pattern.test(body));
}
