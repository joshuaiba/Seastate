// Bundles the server into dist/index.js for `npm start`.
// npm dependencies stay external (they're installed alongside it). Workspace packages such as
// @seastate/shared are TypeScript source with no build of their own, so they're bundled in, along
// with ../seastate.config.ts.
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const pkg = JSON.parse(await readFile(new URL('./package.json', import.meta.url), 'utf8'));

await build({
  absWorkingDir: fileURLToPath(new URL('.', import.meta.url)),
  entryPoints: ['src/index.ts'],
  outfile: 'dist/index.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: true,
  external: Object.keys(pkg.dependencies ?? {}).filter((name) => !name.startsWith('@seastate/')),
  logLevel: 'info',
});
