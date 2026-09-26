/** A failed request to NOAA: network error, timeout, or error response. The API reports these as 502s. */
export class UpstreamError extends Error {
  override name = 'UpstreamError';
  readonly url: string | undefined;
  readonly status: number | undefined;

  constructor(message: string, options: { url?: string; status?: number; cause?: unknown } = {}) {
    super(message, { cause: options.cause });
    this.url = options.url;
    this.status = options.status;
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
