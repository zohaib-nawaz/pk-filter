const CODES =
  'AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS XK YE YT ZA ZM ZW';

export const COUNTRY_CODES: string[] = CODES.split(' ');
export const AUTO_COUNTRY = 'auto';

const KNOWN = new Set(COUNTRY_CODES);

let names: Intl.DisplayNames | null = null;

function displayNames(): Intl.DisplayNames | null {
  if (names) {
    return names;
  }
  try {
    names = new Intl.DisplayNames(['en'], { type: 'region' });
  } catch {
    return null;
  }
  return names;
}

export function isCountryCode(value: unknown): value is string {
  return typeof value === 'string' && KNOWN.has(value);
}

export function countryName(code: string | null | undefined): string {
  if (!code || !isCountryCode(code)) {
    return 'your country';
  }
  const lookup = displayNames();
  if (!lookup) {
    return code;
  }
  const name = lookup.of(code);
  if (!name) {
    return code;
  }
  return name;
}

export function countryOptions(): Array<{ value: string; label: string }> {
  return COUNTRY_CODES.map((code) => ({ value: code, label: countryName(code) })).sort((a, b) => a.label.localeCompare(b.label));
}
