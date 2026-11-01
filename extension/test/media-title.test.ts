import { beforeEach, describe, expect, it } from 'vitest';
import { mediaTitle, linkTitle } from '../src/content/media-title';
import { buildFilename, cleanTitle } from '../src/core/filename';

const never = () => false;

describe('cleanTitle', () => {
  it('drops the site name and generic labels', () => {
    expect(cleanTitle('Finance Landing page by Alamin Hossen on Dribbble', 'Dribbble')).toBe('Finance Landing page by Alamin Hossen');
    expect(cleanTitle('How HLS works - YouTube', 'YouTube')).toBe('How HLS works');
    expect(cleanTitle('Dawn News | Budget 2026 explained', 'Dawn News')).toBe('Budget 2026 explained');
    expect(cleanTitle('  Lots   of   space  ')).toBe('Lots of space');
    expect(cleanTitle('Download')).toBe('');
    expect(cleanTitle('Shot Link')).toBe('');
    expect(cleanTitle('x'.repeat(30) + ' ' + 'y'.repeat(120)).length).toBeLessThanOrEqual(100);
  });
});

describe('mediaTitle', () => {
  beforeEach(() => {
    document.head.innerHTML = '<meta property="og:site_name" content="Dribbble"><title>Trending Animations on Dribbble</title>';
  });

  it('uses the card title instead of the page title', () => {
    document.body.innerHTML = `
      <ul>
        <li><div class="thumb a" data-video-teaser-large="https://cdn.example.com/a.mp4"><img alt="Finance landing page fintech saas web"></div>
          <a href="/shots/1">Shot Link</a><div class="shot-title">Finance Landing page web design</div></li>
        <li><div class="thumb b" data-video-teaser-large="https://cdn.example.com/b.mp4"><img alt="Food app"></div>
          <div class="shot-title">Food Delivery Website</div></li>
      </ul>`;
    const a = document.querySelector('.a') as Element;
    const b = document.querySelector('.b') as Element;
    const others = (self: Element) => (candidate: Element) => [a, b].some((item) => item !== self && (item === candidate || item.contains(candidate)));
    expect(mediaTitle(a, 'https://cdn.example.com/a.mp4', others(a))).toBe('Finance Landing page web design');
    expect(mediaTitle(b, 'https://cdn.example.com/b.mp4', others(b))).toBe('Food Delivery Website');
  });

  it('never borrows another card title when its own card has none', () => {
    document.body.innerHTML = `
      <div class="grid">
        <div class="card"><div class="thumb a"><img alt=""></div></div>
        <div class="card"><div class="thumb b"><img alt=""></div><h3>Other video</h3></div>
      </div>`;
    const a = document.querySelector('.a') as Element;
    const b = document.querySelector('.b') as Element;
    const others = (candidate: Element) => b === candidate || b.contains(candidate);
    expect(mediaTitle(a, 'https://cdn.example.com/clip-a.mp4', others)).toBe('Trending Animations');
  });

  it('prefers the element label, then falls back to page title and file name', () => {
    document.body.innerHTML = '<video title="Product demo"></video><video id="plain"></video>';
    expect(mediaTitle(document.querySelector('video') as Element, 'https://x.com/v.mp4', never)).toBe('Product demo');
    document.head.innerHTML = '<title>Dribbble</title><meta property="og:site_name" content="Dribbble">';
    expect(mediaTitle(document.getElementById('plain') as Element, 'https://x.com/media/Team%20Intro.mp4', never)).toBe('Team Intro');
  });

  it('uses link text unless it is generic', () => {
    document.body.innerHTML = '<section><p><a id="named" href="/a.mp4">Lecture 3 recording</a><a id="generic" href="/b.mp4">Download</a></p><h2>Course week 2</h2></section>';
    expect(linkTitle(document.getElementById('named') as HTMLAnchorElement, 'https://x.com/a.mp4', never)).toBe('Lecture 3 recording');
    expect(linkTitle(document.getElementById('generic') as HTMLAnchorElement, 'https://x.com/b.mp4', never)).toBe('Course week 2');
  });

  it('turns titles into safe file names', () => {
    expect(buildFilename(cleanTitle('Food Delivery & Lifestyle: Website Design | Dribbble', 'Dribbble'), 'mp4')).toBe('Food Delivery & Lifestyle Website Design.mp4');
  });
});
