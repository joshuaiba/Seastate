import { config } from '../../seastate.config';
import { createApp } from './app';
import { env } from './env';
import { TtlCache } from './lib/cache';

/**
 * Entry point for the Vercel Function that answers /api/*. Vercel calls the app as a request handler
 * instead of it listening on a port, and serves the built client itself. The cache lives only as long
 * as a warm function instance.
 */
export default createApp({ config, mode: env.dataMode, cache: new TtlCache(), now: Date.now });
