import { existsSync } from 'node:fs';
import express, { type ErrorRequestHandler, type Express, type Response } from 'express';
import type { ApiErrorBody, BeachConfig, BeachInfo, BeachesResponse, LocationInfo } from '@seastate/shared';
import { env } from './env';
import { UpstreamError, errorMessage } from './lib/errors';
import { CLIENT_DIST } from './paths';
import { isSourceId, sources } from './sources';
import type { SourceContext } from './sources/types';

/**
 * The HTTP app. All NOAA traffic goes through here, never from the browser: NDBC sends no CORS
 * headers, and a single server-side cache keeps request volume low. Upstream URLs are built only from
 * seastate.config.ts; a beach id in the path only selects one of the configured beaches, and nothing
 * else from the incoming request is forwarded upstream.
 */
export function createApp(ctx: SourceContext): Express {
  const app = express();
  app.disable('x-powered-by');

  const { beaches, data } = ctx.config;
  const defaultBeach = beaches[0];
  if (!defaultBeach) throw new Error('seastate.config.ts lists no beaches');
  const beachInfo = (beach: BeachConfig): BeachInfo => ({ ...beach, tideDatum: data.tideDatum });

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.get('/api/beaches', (_req, res) => {
    const body: BeachesResponse = { mode: ctx.mode, beaches: beaches.map(beachInfo) };
    res.json(body);
  });

  app.get('/api/beaches/:beachId/sources/:id', async (req, res) => {
    const beach = findBeach(res, req.params.beachId);
    if (!beach) return;
    const { id } = req.params;
    if (!isSourceId(id)) {
      sendError(res, 404, `Unknown source "${id}". Available: ${Object.keys(sources).join(', ')}`);
      return;
    }
    res.json(await sources[id](ctx, beach));
  });

  // The original single-beach routes, answered for the default beach.
  app.get('/api/location', (_req, res) => {
    const body: LocationInfo = { ...beachInfo(defaultBeach), mode: ctx.mode };
    res.json(body);
  });

  app.get('/api/sources/:id', async (req, res) => {
    const { id } = req.params;
    if (!isSourceId(id)) {
      sendError(res, 404, `Unknown source "${id}". Available: ${Object.keys(sources).join(', ')}`);
      return;
    }
    res.json(await sources[id](ctx, defaultBeach));
  });

  app.use('/api', (req, res) => {
    sendError(res, 404, `No such endpoint: ${req.method} ${req.originalUrl}`);
  });

  // In production the built client is served by this same process, on the same port. In development
  // Vite serves it and forwards /api here (see client/vite.config.ts).
  if (env.isProduction) {
    if (existsSync(CLIENT_DIST)) app.use(express.static(CLIENT_DIST));
    else console.warn(`No client build at ${CLIENT_DIST}; run \`npm run build\` to serve the UI.`);
  }

  app.use(errorHandler);
  return app;

  function findBeach(res: Response, id: string): BeachConfig | undefined {
    const beach = beaches.find((b) => b.id === id);
    if (!beach) sendError(res, 404, `Unknown beach "${id}". Available: ${beaches.map((b) => b.id).join(', ')}`);
    return beach;
  }
}

const errorHandler: ErrorRequestHandler = (error, req, res, next) => {
  if (res.headersSent) {
    next(error);
    return;
  }
  console.error(`[api] ${req.method} ${req.originalUrl} failed: ${errorMessage(error)}`);
  sendError(res, error instanceof UpstreamError ? 502 : 500, errorMessage(error));
};

function sendError(res: Response, status: number, message: string): void {
  const body: ApiErrorBody = { error: { message } };
  res.status(status).json(body);
}
