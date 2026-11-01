import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build as buildScripts } from 'esbuild';
import { build as buildPages } from 'vite';
import { iconPng } from './icons.mjs';

const root = resolve(import.meta.dirname, '..');
const dist = resolve(root, 'dist');
const apiUrl = new URL(process.env.API_URL ?? 'http://localhost:8787');
const isLocal = ['localhost', '127.0.0.1'].includes(apiUrl.hostname);

if (apiUrl.protocol !== 'https:' && !isLocal) {
  throw new Error(`API_URL must use https (got ${apiUrl.href})`);
}

const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
const iconSizes = [16, 32, 48, 128];
const icons = Object.fromEntries(iconSizes.map((size) => [size, `icons/icon-${size}.png`]));

const manifest = {
  manifest_version: 3,
  name: 'PK Access Filter',
  version: pkg.version,
  description: 'Shows which Google results are accessible from Pakistan, hides confirmed blocked sites and downloads direct video files.',
  permissions: ['storage'],
  host_permissions: [`${apiUrl.origin}/*`],
  optional_permissions: ['downloads', 'downloads.open', 'notifications', 'scripting'],
  optional_host_permissions: ['http://*/*', 'https://*/*'],
  background: { service_worker: 'background.js' },
  content_scripts: [
    {
      matches: [
        'https://www.google.com/search*',
        'https://google.com/search*',
        'https://www.google.com.pk/search*',
        'https://google.com.pk/search*',
      ],
      js: ['content.js'],
      run_at: 'document_idle',
    },
  ],
  action: { default_title: 'PK Access Filter', default_popup: 'popup/index.html', default_icon: icons },
  options_ui: { page: 'options/index.html', open_in_tab: true },
  icons,
  content_security_policy: { extension_pages: "script-src 'self'; object-src 'self'" },
  minimum_chrome_version: '110',
};

await rm(dist, { recursive: true, force: true });
await mkdir(resolve(dist, 'icons'), { recursive: true });

await buildPages({ configFile: resolve(root, 'vite.config.ts'), logLevel: 'warn' });

await buildScripts({
  entryPoints: {
    background: resolve(root, 'src/background/service-worker.ts'),
    content: resolve(root, 'src/content/google-search.ts'),
    video: resolve(root, 'src/content/video-page.ts'),
  },
  outdir: dist,
  bundle: true,
  format: 'iife',
  target: 'chrome110',
  minify: true,
  define: { __API_URL__: JSON.stringify(apiUrl.origin) },
  logLevel: 'warning',
});

await Promise.all(iconSizes.map((size) => writeFile(resolve(dist, `icons/icon-${size}.png`), iconPng(size))));
await writeFile(resolve(dist, 'manifest.json'), JSON.stringify(manifest, null, 2));

console.log(`Built extension in dist/ (API: ${apiUrl.origin})`);
