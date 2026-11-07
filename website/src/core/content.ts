import { MAX_FRAMES } from './frames';

export interface NavLink {
  label: string;
  href: string;
}

export interface Feature {
  icon: IconName;
  title: string;
  text: string;
}

export interface Step {
  title: string;
  text: string;
}

export interface InstallGuide {
  id: string;
  browser: string;
  steps: string[];
}

export interface Question {
  question: string;
  answer: string;
}

export type IconName = 'badge' | 'filter' | 'globe' | 'network' | 'alert' | 'cursor' | 'download' | 'moon';

export const NAV_LINKS: NavLink[] = [
  { label: 'Features', href: '/#features' },
  { label: 'Check a site', href: '/#check' },
  { label: 'Download', href: '/download.html' },
  { label: 'Thumbnails', href: '/thumbnails.html' },
  { label: 'Frames', href: '/frames.html' },
  { label: 'How it works', href: '/#how' },
  { label: 'Install', href: '/#install' },
  { label: 'FAQ', href: '/#faq' },
];

export const FEATURES: Feature[] = [
  {
    icon: 'badge',
    title: 'Badges on every result',
    text: 'Google, Bing and DuckDuckGo results show Accessible, Blocked, Possibly blocked or Unknown before you click.',
  },
  {
    icon: 'filter',
    title: 'Hide what will not open',
    text: 'Optionally hide confirmed blocked sites, or keep only results that open. Nothing is hidden unless you choose to.',
  },
  {
    icon: 'globe',
    title: 'Any country, VPN included',
    text: 'The country follows your IP address, so switching your VPN to London shows what is blocked in the UK.',
  },
  {
    icon: 'network',
    title: 'Real networks, real history',
    text: 'Live tests from servers on local ISPs, cross-checked with OONI, plus a 30-day history for every site.',
  },
  {
    icon: 'alert',
    title: 'When a site does not open',
    text: 'Instead of a bare error page, see whether the site is blocked where you are and open an archived copy.',
  },
  {
    icon: 'cursor',
    title: 'Right-click any link',
    text: 'Choose “Check if this link is blocked” on any page to see its status in a small window.',
  },
  {
    icon: 'download',
    title: 'Video downloader',
    text: 'Download direct video and audio files with one click. Streams only on websites you add yourself.',
  },
  {
    icon: 'moon',
    title: 'Saves your data',
    text: 'Pick a lower quality, save just the audio, or queue videos for cheaper night-time internet.',
  },
];

export const STEPS: Step[] = [
  {
    title: 'A server in the country tests the site',
    text: 'DNS, HTTPS and HTTP are checked from a real local network and compared with an independent resolver. Block pages are recognised.',
  },
  {
    title: 'OONI measurements back it up',
    text: 'Results are cross-checked with thousands of volunteer measurements from the same country. Countries without a test server use OONI alone.',
  },
  {
    title: 'Your own connection has the last word',
    text: 'The extension also tries the site from your browser, through your VPN if one is on, so the badge matches what you can really open.',
  },
];

export const STATUS_HELP: Array<{ status: 'accessible' | 'blocked' | 'possibly_blocked' | 'unknown'; text: string }> = [
  { status: 'accessible', text: 'Opens from networks in this country.' },
  { status: 'blocked', text: 'Strong, matching evidence of blocking, such as a government block page.' },
  { status: 'possibly_blocked', text: 'Suspicious DNS or connection behaviour, or blocked on some networks only.' },
  { status: 'unknown', text: 'Not enough data yet. Never shown as accessible by guesswork.' },
];

export const INSTALL_GUIDES: InstallGuide[] = [
  {
    id: 'chrome',
    browser: 'Chrome',
    steps: [
      'Download the latest extension zip from the releases page and unzip it.',
      'Open chrome://extensions and turn on Developer mode.',
      'Click “Load unpacked” and choose the unzipped folder.',
      'Search on Google, Bing or DuckDuckGo and look for the badges.',
    ],
  },
  {
    id: 'edge',
    browser: 'Edge',
    steps: [
      'Download the same Chrome zip from the releases page and unzip it.',
      'Open edge://extensions and turn on Developer mode.',
      'Click “Load unpacked” and choose the unzipped folder.',
      'Search as usual; badges appear next to each result.',
    ],
  },
  {
    id: 'firefox',
    browser: 'Firefox',
    steps: [
      'Download the Firefox zip from the releases page.',
      'Open about:debugging#/runtime/this-firefox.',
      'Click “Load Temporary Add-on” and pick manifest.json inside the zip.',
      'Stream (HLS/DASH) downloads are not available in Firefox yet; everything else works.',
    ],
  },
];

export const SITE_OWNER_SNIPPET = `<!-- Mark your own player as downloadable -->
<video src="/clips/intro.m3u8"
       data-download-url="https://example.com/files/intro.mp4"></video>

<!-- Or point to the full file for the whole page -->
<link rel="alternate" type="video/mp4"
      href="https://example.com/files/intro.mp4">`;

export const FAQ: Question[] = [
  {
    question: 'Does it unblock websites?',
    answer:
      'No. It tells you whether a site is blocked where you are and offers an archived copy from the Internet Archive. It does not route your traffic anywhere.',
  },
  {
    question: 'What does it send to the server?',
    answer:
      'Only domain names, such as example.com: search results, sites you check, and sites that fail to load if you turn that on. Never search queries, full addresses or your browsing history.',
  },
  {
    question: 'Why does a site say Unknown?',
    answer:
      'There is no recent measurement for that site in that country. With “Also check from my own connection” on, the extension tests it from your browser instead.',
  },
  {
    question: 'Can it download YouTube or Facebook videos?',
    answer:
      'No. It downloads direct media files and, on websites you add yourself, HLS or DASH streams. DRM, live streams and platforms that do not allow downloads are skipped.',
  },
  {
    question: 'Which countries are supported?',
    answer:
      'All of them. Countries with a test server get live tests on local networks, and any country can add one. Elsewhere, results come from OONI volunteer measurements and your own connection.',
  },
];

export const DOWNLOAD_SUPPORT = [
  'Direct video and audio links (MP4, WebM, MOV, MKV, MP3, M4A and more).',
  'Pages that publish their video, through the player, og:video, schema.org or a download link.',
  'HLS (.m3u8) and DASH (.mpd) streams, with every quality listed.',
  'MP4 streams with separate sound are joined into one file.',
];

export const DOWNLOAD_LIMITS = [
  'Downloads from YouTube, Facebook, Instagram, TikTok, X, Vimeo and other platforms that do not allow them. TikTok links show the video in TikTok’s own player instead.',
  'Netflix and any DRM-protected or encrypted video.',
  'Adult video sites.',
  'Live streams, and videos larger than the server limit.',
];

export const THUMBNAIL_SUPPORT = [
  'YouTube videos and Shorts, in every size from Small to Full HD.',
  'Vimeo, Dailymotion and TikTok, through their official embed services.',
  'Any page that publishes a preview image: the player poster, og:image, Twitter cards or schema.org.',
  'Direct image links.',
];

export const THUMBNAIL_LIMITS = [
  'Instagram and Facebook, until this server is connected to Meta’s official API.',
  'X, Netflix, adult sites and other platforms that do not share thumbnails publicly.',
  'Private, removed or age-restricted videos.',
  'Video files have no separate thumbnail. Use the frame extractor to save any frame instead.',
];

export const FRAME_SUPPORT = [
  'Video files on your device, read in your browser. Nothing is uploaded.',
  'Direct video links and pages that publish an MP4 or WebM file.',
  'Any frame rate from one frame every few minutes up to 60 per second.',
  'Lossless PNG, HD JPG, or compressed WebP down to 240p.',
];

export const FRAME_LIMITS = [
  'Streams (HLS and DASH) and platforms that do not allow downloads. Download the video first, then open the file.',
  'DRM-protected video.',
  `More than ${MAX_FRAMES} frames in one go. Pick a shorter range or a lower frame rate.`,
  'Formats your browser cannot play, such as some MKV and AVI files.',
];
