import { describe, expect, it } from 'vitest';
import { isSafeTargetHost, normalizeDomain } from '../src/utils/domain.js';
import { isPublicIp } from '../src/utils/ip.js';

describe('normalizeDomain', () => {
  it('normalizes hosts and urls', () => {
    expect(normalizeDomain('WWW.Example.COM')).toBe('example.com');
    expect(normalizeDomain('https://news.bbc.co.uk/path?q=1')).toBe('news.bbc.co.uk');
    expect(normalizeDomain('example.com.')).toBe('example.com');
    expect(normalizeDomain('münchen.de')).toBe('xn--mnchen-3ya.de');
  });

  it('rejects unsafe or invalid input', () => {
    for (const input of ['localhost', '127.0.0.1', 'http://10.0.0.1', 'printer.local', 'foo', 'ftp://example.com', 'a..com', '-bad.com', 'http://user:pw@example.com', '']) {
      expect(normalizeDomain(input), input).toBeNull();
    }
  });
});

describe('isPublicIp', () => {
  it('accepts public addresses', () => {
    expect(isPublicIp('8.8.8.8')).toBe(true);
    expect(isPublicIp('2606:4700:4700::1111')).toBe(true);
  });

  it('rejects private, loopback, link-local and reserved ranges', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fe80::1', 'fd00::1', '::ffff:127.0.0.1', '224.0.0.1', 'not-an-ip']) {
      expect(isPublicIp(ip), ip).toBe(false);
    }
  });

  it('validates redirect targets', () => {
    expect(isSafeTargetHost('example.com')).toBe(true);
    expect(isSafeTargetHost('93.184.216.34')).toBe(true);
    expect(isSafeTargetHost('[::1]')).toBe(false);
    expect(isSafeTargetHost('169.254.169.254')).toBe(false);
  });
});
