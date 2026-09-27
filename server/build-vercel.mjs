// Writes the Vercel deployment to ../.vercel/output (Build Output API v3): the built client as static
// files, and the API as one Node function bundled with all of its dependencies. Run after the client
// build, via `npm run build:vercel` at the repo root.
import { build } from 'esbuild';
import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const output = `${root}.vercel/output`;
const fn = `${output}/functions/api.func`;

await rm(output, { recursive: true, force: true });
await mkdir(fn, { recursive: true });
await cp(`${root}client/dist`, `${output}/static`, { recursive: true });

await build({
  absWorkingDir: fileURLToPath(new URL('.', import.meta.url)),
  entryPoints: ['src/vercel.ts'],
  outfile: `${fn}/index.mjs`,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  // Express is CommonJS and requires Node built-ins, which an ESM bundle can only do through this.
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  logLevel: 'info',
});

await writeFile(
  `${fn}/.vc-config.json`,
  JSON.stringify({ runtime: 'nodejs22.x', handler: 'index.mjs', launcherType: 'Nodejs', shouldAddHelpers: false }),
);
await writeFile(
  `${output}/config.json`,
  JSON.stringify({ version: 3, routes: [{ src: '^/api(/.*)?$', dest: '/api' }, { handle: 'filesystem' }] }),
);
