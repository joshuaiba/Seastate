import { describe, expect, it } from 'vitest';
import { MANIFEST_FILE, readFixture, retimeFixture, type FixtureManifest } from './fixtures';
import { HOUR_MS, MINUTE_MS } from './time';

// Uses the committed server/fixtures/manifest.json, whatever its capture time is.
const { capturedAt } = JSON.parse(await readFixture(MANIFEST_FILE)) as FixtureManifest;
const captured = Date.parse(capturedAt);

describe('retimeFixture', () => {
  it('shifts rows forward by whole hours so the capture time lands within the past hour', async () => {
    const rows = [{ time: capturedAt, waveHeightM: 0.7 }];

    const [row] = await retimeFixture(rows, captured + 72 * HOUR_MS + 25 * MINUTE_MS);

    expect(row).toEqual({ time: new Date(captured + 72 * HOUR_MS).toISOString(), waveHeightM: 0.7 });
  });

  it('never shifts backwards', async () => {
    const [row] = await retimeFixture([{ time: capturedAt }], captured - HOUR_MS);

    expect(row?.time).toBe(new Date(captured).toISOString());
  });
});
