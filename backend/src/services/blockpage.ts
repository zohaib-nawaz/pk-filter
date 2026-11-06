const FINGERPRINTS: RegExp[] = [
  /not allowed for view(?:ing|ership) from within/i,
  /prohibited for view(?:ing|ership) from within/i,
  /surf safely![\s\S]{0,600}(?:blocked|prohibited|not allowed)/i,
  /(?:site|website|page|url)[\s\S]{0,60}(?:has been|is) blocked[\s\S]{0,200}(?:telecommunications?|communications|regulatory) (?:and [\w ]{1,40} )?authority/i,
  /blocked (?:as per|under|by order of|on the (?:order|direction|instructions) of)[\s\S]{0,160}(?:authority|court|ministry|government)/i,
];

export function detectBlockpage(body: string): boolean {
  return body.length > 0 && FINGERPRINTS.some((pattern) => pattern.test(body));
}
