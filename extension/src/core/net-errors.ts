const CHROME_ERRORS = new Set([
  'net::ERR_CONNECTION_RESET',
  'net::ERR_CONNECTION_CLOSED',
  'net::ERR_CONNECTION_REFUSED',
  'net::ERR_CONNECTION_TIMED_OUT',
  'net::ERR_CONNECTION_ABORTED',
  'net::ERR_TIMED_OUT',
  'net::ERR_NAME_NOT_RESOLVED',
  'net::ERR_ADDRESS_UNREACHABLE',
  'net::ERR_EMPTY_RESPONSE',
  'net::ERR_SSL_PROTOCOL_ERROR',
  'net::ERR_QUIC_PROTOCOL_ERROR',
  'net::ERR_CERT_COMMON_NAME_INVALID',
  'net::ERR_TUNNEL_CONNECTION_FAILED',
]);

const FIREFOX_ERRORS = new Map([
  ['2152398861', 'NS_ERROR_CONNECTION_REFUSED'],
  ['2152398862', 'NS_ERROR_NET_TIMEOUT'],
  ['2152398868', 'NS_ERROR_NET_RESET'],
  ['2152398878', 'NS_ERROR_UNKNOWN_HOST'],
  ['2152398919', 'NS_ERROR_NET_INTERRUPT'],
]);

const DESCRIPTIONS: Record<string, string> = {
  RESET: 'The connection was cut off while opening the site.',
  CLOSED: 'The connection was cut off while opening the site.',
  INTERRUPT: 'The connection was cut off while opening the site.',
  REFUSED: 'The site refused the connection.',
  TIMED_OUT: 'The site took too long to answer.',
  TIMEOUT: 'The site took too long to answer.',
  NAME_NOT_RESOLVED: 'The site name could not be found.',
  UNKNOWN_HOST: 'The site name could not be found.',
  SSL: 'A secure connection to the site could not be made.',
  CERT: 'A secure connection to the site could not be made.',
};

function firefoxName(error: string): string | null {
  const code = /(\d{9,})/.exec(error);
  if (code && FIREFOX_ERRORS.has(code[1] as string)) {
    return FIREFOX_ERRORS.get(code[1] as string) as string;
  }
  const named = [...FIREFOX_ERRORS.values()].find((name) => error.includes(name));
  if (named) {
    return named;
  }
  return null;
}

export function accessFailure(error: string): string | null {
  if (CHROME_ERRORS.has(error)) {
    return error.replace('net::ERR_', '');
  }
  const firefox = firefoxName(error);
  if (firefox) {
    return firefox.replace('NS_ERROR_', '').replace('NET_', '');
  }
  return null;
}

export function describeFailure(code: string | null): string {
  if (!code) {
    return 'The site did not open.';
  }
  const key = Object.keys(DESCRIPTIONS).find((part) => code.includes(part));
  if (!key) {
    return 'The site did not open.';
  }
  return DESCRIPTIONS[key] as string;
}
