import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build } from 'esbuild';

const root = resolve(import.meta.dirname, '..');

await rm(resolve(root, 'dist'), { recursive: true, force: true });
await build({
  entryPoints: { server: resolve(root, 'src/server.ts'), 'migrate-cli': resolve(root, 'src/database/migrate-cli.ts') },
  outdir: resolve(root, 'dist'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  packages: 'external',
  sourcemap: true,
  logLevel: 'warning',
});
console.log('Built backend in dist/');
