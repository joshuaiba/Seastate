import path from 'node:path';
import { fileURLToPath } from 'node:url';

// This file runs as server/src/paths.ts in development and inside the bundle at server/dist/index.js
// in production. Both are one directory below server/, so '..' is the server package either way.
const SERVER_ROOT = fileURLToPath(new URL('..', import.meta.url));

/** Captured NOAA responses for offline mode (see lib/fixtures.ts). */
export const FIXTURES_DIR = path.join(SERVER_ROOT, 'fixtures');

/** The built client, served by Express in production. */
export const CLIENT_DIST = path.join(SERVER_ROOT, '..', 'client', 'dist');
