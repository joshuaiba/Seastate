import type { DataMode } from '@seastate/shared';

/** Runtime settings from environment variables. The beach and stations live in seastate.config.ts. */
export const env = {
  /** Port for the API and, in production, the built client. */
  port: Number(process.env.PORT ?? 3001),
  /** "live" (default) calls NOAA. "fixture" serves responses captured in server/fixtures, with no network. */
  dataMode: parseDataMode(process.env.SEASTATE_DATA_MODE),
  /** Identifies this app in requests to NOAA. */
  userAgent: process.env.SEASTATE_USER_AGENT ?? 'seastate/0.1 (personal coastal conditions dashboard)',
  /** In production the server also serves the built client from client/dist. */
  isProduction: process.env.NODE_ENV === 'production',
  /** On Vercel the API runs as a function and Vercel serves the built client itself. */
  onVercel: process.env.VERCEL === '1',
};

function parseDataMode(value: string | undefined): DataMode {
  if (value === undefined || value === '' || value === 'live') return 'live';
  if (value === 'fixture') return 'fixture';
  throw new Error(`SEASTATE_DATA_MODE must be "live" or "fixture", got "${value}"`);
}
