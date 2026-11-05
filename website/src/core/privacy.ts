export interface PolicySection {
  title: string;
  paragraphs: string[];
  items?: string[];
}

export const POLICY_UPDATED = '5 November 2026';

export const POLICY: PolicySection[] = [
  {
    title: 'What the extension sends',
    paragraphs: ['To check a website, the extension sends only its domain name, such as example.com, to the checking service. That happens for:'],
    items: [
      'domains shown in your Google, Bing or DuckDuckGo results;',
      'sites you check from the popup, the right-click menu or this website;',
      'sites that fail to load, only if you turn on “Explain sites that fail to load”.',
    ],
  },
  {
    title: 'What is never collected',
    paragraphs: ['Search queries, full page addresses, page content, cookies, passwords and browsing history are never sent. There are no accounts, ads or analytics.'],
  },
  {
    title: 'Your country',
    paragraphs: [
      'The checking service works out your country from the IP address of the request so it can show results for that country. The IP address is not stored.',
      'If the service cannot tell (for example when it runs on your own computer), the extension asks Cloudflare’s public trace page for your country, at most once a minute.',
    ],
  },
  {
    title: 'Checks from your own connection',
    paragraphs: [
      'With “Also check from my own connection” on (the default), your browser tries to connect to each checked site, without cookies, to see if it opens. Those sites see that connection like a normal visit. You can turn it off in Settings.',
    ],
  },
  {
    title: 'What the service stores',
    paragraphs: [
      'For each check: the domain, the result, the evidence and the test network. Records older than 30 days are deleted automatically. Nothing links a check to a person.',
    ],
  },
  {
    title: 'Downloads',
    paragraphs: [
      'Videos download straight from the website to your computer through your browser. Nothing passes through our servers. The download list stays in your browser.',
    ],
  },
  {
    title: 'Permissions',
    paragraphs: ['Required permissions show no install warning. Everything else is optional and requested only when you turn on the matching setting:'],
    items: [
      'storage, activeTab, contextMenus and alarms: settings, the current tab’s site, the right-click check and night downloads;',
      'downloads, notifications, scripting and site access: the video downloader;',
      'webNavigation: explaining sites that fail to load.',
    ],
  },
  {
    title: 'Third parties',
    paragraphs: [
      'Checks are cross-checked with public OONI data by the service. Archived copies open on the Internet Archive and evidence links open on OONI Explorer, only when you click them.',
    ],
  },
];
