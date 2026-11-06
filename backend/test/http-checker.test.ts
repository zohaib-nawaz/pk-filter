import { describe, expect, it } from 'vitest';
import { detectBlockpage } from '../src/services/blockpage.js';
import { checkHttp, nextRedirect } from '../src/services/http-checker.js';

describe('http checker safety', () => {
  it('refuses to connect to private addresses', async () => {
    const result = await checkHttp('example.com', 'https', ['127.0.0.1'], 1000);
    expect(result.error).toBe('unsafe_address');
    expect(result.status).toBeNull();
  });

  it('reports a dns failure when there are no addresses', async () => {
    expect((await checkHttp('example.com', 'https', [], 1000)).error).toBe('dns');
  });

  it('only follows redirects to public http(s) targets', () => {
    const base = new URL('https://example.com/');
    expect(nextRedirect(base, '/next').toString()).toBe('https://example.com/next');
    expect(nextRedirect(base, 'http://www.example.com/').hostname).toBe('www.example.com');
    for (const location of ['http://127.0.0.1/', 'http://169.254.169.254/latest', 'file:///etc/passwd', 'http://example.com:8080/', 'http://localhost/', 'http://[::1]/']) {
      expect(() => nextRedirect(base, location), location).toThrow();
    }
  });
});

describe('detectBlockpage', () => {
  it('matches block pages by their wording, not by country', () => {
    expect(detectBlockpage('<h1>Surf Safely!</h1><p>This website contains content that is not allowed for viewing from within this country.</p>')).toBe(true);
    expect(detectBlockpage('<p>This site has been blocked as per the instructions of the Telecommunication Authority.</p>')).toBe(true);
    expect(detectBlockpage('<title>Telecommunication Authority</title>')).toBe(false);
    expect(detectBlockpage('<h1>Welcome</h1>')).toBe(false);
  });
});
