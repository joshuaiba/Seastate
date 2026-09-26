import type { SourceId } from '@seastate/shared';
import { loadCoops } from './coops/source';
import { loadNdbc } from './ndbc/source';
import type { SourceLoader } from './types';

/**
 * Every data source, by id. Each one is served at GET /api/sources/<id>.
 *
 * To add a source (a swell forecast API, say):
 *   1. shared/src/api.ts: add `<id>: <PayloadType>` to SourcePayloads.
 *   2. server/src/sources/<id>/: write client.ts (fetch + parse through loadRows, so offline mode works)
 *      and source.ts (a SourceLoader that caches each upstream request).
 *   3. Register the loader below. TypeScript reports an error here until you do.
 *   4. Run `npm run fixtures` to capture offline data for it.
 */
export const sources: { [K in SourceId]: SourceLoader<K> } = {
  ndbc: loadNdbc,
  coops: loadCoops,
};

export function isSourceId(id: string): id is SourceId {
  return Object.hasOwn(sources, id);
}
