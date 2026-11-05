import { beforeEach, describe, expect, it } from 'vitest';
import { claimResults, releaseAll } from '../src/content/result-detector';

const organic = (href: string, cite: string, title = 'Title') => `
  <div class="MjjYud"><div data-hveid="1" class="result">
    <div class="yuRUbf"><span><a href="${href}"><h3>${title}</h3><br><div><span class="VuuXrf">Site</span><cite>${cite}</cite></div></a></span></div>
    <div class="sitelinks"><a href="https://example.org/sub"><h3>Sitelink</h3></a></div>
  </div></div>`;

beforeEach(() => {
  document.body.innerHTML = `
    <div id="tads"><div data-hveid="9"><a href="https://ads.example.net"><h3>Ad</h3></a></div></div>
    <div id="search"><div id="rso">
      ${organic('/goto?url=OPAQUE', 'https://en.wikipedia.org › wiki', 'Wikipedia')}
      ${organic('https://www.dawn.com/news', 'https://www.dawn.com › news', 'Dawn')}
      <div class="xpdopen"><div data-hveid="5"><a href="https://snippet.example.com"><h3>Snippet</h3></a></div></div>
    </div></div>`;
});

describe('claimResults', () => {
  it('finds organic results, skips ads, snippets and sitelinks', () => {
    const results = claimResults(document, 'https://www.google.com');
    expect(results.map((r) => r.domain)).toEqual(['en.wikipedia.org', 'dawn.com']);
    expect(results[0]?.heading.textContent).toBe('Wikipedia');
    expect(results[0]?.displayedUrl).toBe('https://en.wikipedia.org › wiki');
  });

  it('never claims the same result twice', () => {
    expect(claimResults(document, 'https://www.google.com')).toHaveLength(2);
    expect(claimResults(document, 'https://www.google.com')).toHaveLength(0);
    releaseAll(document);
    expect(claimResults(document, 'https://www.google.com')).toHaveLength(2);
  });
});

describe('decorateVideoResult', () => {
  it('marks streaming platforms without promising a download', async () => {
    const { decorateVideoResult } = await import('../src/content/google-videos');
    document.body.innerHTML = `<div id="search"><div data-hveid="1"><a href="/goto?url=x"><h3>Clip</h3><div><span class="VuuXrf">YouTube · Channel</span><cite>youtube.com</cite></div></a></div>
      <div data-hveid="2"><a href="https://www.dawn.com/news"><h3>News</h3><cite>https://www.dawn.com</cite></a></div></div>`;
    const results = claimResults(document, 'https://www.google.com');
    const buttons = results.map((result) => decorateVideoResult(result, true));
    expect(buttons[0]).not.toBeNull();
    expect(buttons[1]).toBeNull();
    releaseAll(document);
    for (const element of document.querySelectorAll('pkaf-video')) {
      element.remove();
    }
    expect(claimResults(document, 'https://www.google.com').map((result) => decorateVideoResult(result, false))).toEqual([null, null]);
  });
});
