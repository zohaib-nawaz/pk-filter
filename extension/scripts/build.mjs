import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build as buildScripts } from 'esbuild';
import { build as buildPages } from 'vite';
import { iconPng } from './icons.mjs';

const root = resolve(import.meta.dirname, '..');
const target = process.env.TARGET ?? 'chrome';
const firefox = target === 'firefox';

if (!['chrome', 'firefox'].includes(target)) {
  throw new Error(`TARGET must be chrome or firefox (got ${target})`);
}

const dist = resolve(root, firefox ? 'dist-firefox' : 'dist');
const apiUrl = new URL(process.env.API_URL ?? 'http://localhost:8787');
const isLocal = ['localhost', '127.0.0.1'].includes(apiUrl.hostname);

if (apiUrl.protocol !== 'https:' && !isLocal) {
  throw new Error(`API_URL must use https (got ${apiUrl.href})`);
}

const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
const iconSizes = [16, 32, 48, 128];
const icons = Object.fromEntries(iconSizes.map((size) => [size, `icons/icon-${size}.png`]));

const basePermissions = ['storage', 'activeTab', 'contextMenus', 'alarms'];
const optionalPermissions = ['downloads', 'downloads.open', 'notifications', 'scripting', 'webNavigation'];

const browserParts = firefox
  ? {
      permissions: basePermissions,
      optional_permissions: optionalPermissions.filter((permission) => permission !== 'downloads.open'),
      background: { scripts: ['background.js'] },
      browser_specific_settings: {
        gecko: {
          id: 'pk-access-filter@zohaib-nawaz',
          strict_min_version: '128.0',
          data_collection_permissions: { required: ['browsingActivity'] },
        },
      },
    }
  : {
      permissions: [...basePermissions, 'offscreen'],
      optional_permissions: optionalPermissions,
      background: { service_worker: 'background.js' },
      minimum_chrome_version: '116',
    };

const manifest = {
  manifest_version: 3,
  name: 'PK Access Filter',
  version: pkg.version,
  description: 'Shows which Google, Bing and DuckDuckGo results are accessible from Pakistan, explains sites that fail to load and downloads direct video files.',
  host_permissions: [`${apiUrl.origin}/*`],
  optional_host_permissions: ['http://*/*', 'https://*/*'],
  ...browserParts,
  content_scripts: [
    {
      matches: [
        'https://www.google.com/search*',
        'https://google.com/search*',
        'https://www.google.com.pk/search*',
        'https://google.com.pk/search*',
        'https://www.bing.com/search*',
        'https://duckduckgo.com/*',
      ],
      js: ['content.js'],
      run_at: 'document_idle',
    },
  ],
  action: { default_title: 'PK Access Filter', default_popup: 'popup/index.html', default_icon: icons },
  options_ui: { page: 'options/index.html', open_in_tab: true },
  icons,
  content_security_policy: { extension_pages: "script-src 'self'; object-src 'self'" },
};

await rm(dist, { recursive: true, force: true });
await mkdir(resolve(dist, 'icons'), { recursive: true });

await buildPages({ configFile: resolve(root, 'vite.config.ts'), logLevel: 'warn', build: { outDir: dist } });

const entryPoints = {
  background: resolve(root, 'src/background/service-worker.ts'),
  content: resolve(root, 'src/content/google-search.ts'),
  video: resolve(root, 'src/content/video-page.ts'),
};

await buildScripts({
  entryPoints: firefox ? entryPoints : { ...entryPoints, offscreen: resolve(root, 'src/offscreen/offscreen.ts') },
  outdir: dist,
  bundle: true,
  format: 'iife',
  target: firefox ? 'firefox128' : 'chrome116',
  minify: true,
  define: { __API_URL__: JSON.stringify(apiUrl.origin) },
  logLevel: 'warning',
});

await Promise.all(iconSizes.map((size) => writeFile(resolve(dist, `icons/icon-${size}.png`), iconPng(size))));
if (!firefox) {
  await writeFile(
    resolve(dist, 'offscreen.html'),
    '<!doctype html><html><head><meta charset="utf-8"><title>Stream assembler</title></head><body><script src="offscreen.js"></script></body></html>',
  );
}
await writeFile(resolve(dist, 'manifest.json'), JSON.stringify(manifest, null, 2));

console.log(`Built ${target} extension in ${firefox ? 'dist-firefox' : 'dist'}/ (API: ${apiUrl.origin})`);
