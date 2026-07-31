import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { CompiledContentPack } from '@woven-deep/content';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import type { ArtifactLedger, ArtifactStint, StoredHallRecord } from '@woven-deep/engine';
import {
  artifactDrawbackRows,
  artifactOf,
  isArtifact,
  isFuellessLight,
  provenanceLines,
  provenanceLine,
  relicsOverview,
} from '../src/session/artifact-view.js';

let pack: CompiledContentPack;

beforeAll(async () => {
  pack = await compileContentDirectory({
    rootDir: resolve(import.meta.dirname, '../../../content'),
  });
});

function stint(overrides: Partial<ArtifactStint> = {}): ArtifactStint {
  return {
    heroName: 'Kaelen',
    recordId: 'record.kaelen',
    outcome: 'died-with',
    depth: 14,
    ...overrides,
  };
}

/** Only the two fields the provenance join reads off a Hall record -- building a genuine
 * `StoredHallRecord` here would mean driving `finalizeRun`, which this pure join never touches. */
function record(recordId: string, completionType: StoredHallRecord['completionType']) {
  return { recordId, completionType } as unknown as StoredHallRecord;
}

describe('provenanceLine', () => {
  it('renders the four stint outcomes with their outcome text and depth', () => {
    expect(provenanceLine(stint({ outcome: 'died-with' }), undefined)).toBe(
      'Borne by Kaelen — fell at depth 14',
    );
    expect(provenanceLine(stint({ outcome: 'recovered' }), undefined)).toBe(
      'Borne by Kaelen — reclaimed it at depth 14',
    );
    expect(provenanceLine(stint({ outcome: 'escaped-with' }), undefined)).toBe(
      'Borne by Kaelen — carried it out at depth 14',
    );
    expect(provenanceLine(stint({ outcome: 'reclaimed-by-the-deep' }), undefined)).toBe(
      'Borne by Kaelen — the Deep took it back at depth 14',
    );
  });

  it('omits the depth clause for a depth-0 reclaim stint (the reconcile pass records no depth)', () => {
    expect(provenanceLine(stint({ outcome: 'reclaimed-by-the-deep', depth: 0 }), undefined)).toBe(
      'Borne by Kaelen — the Deep took it back',
    );
  });

  it('keeps a genuine depth 0 for every other outcome (a hero can fall in town)', () => {
    expect(provenanceLine(stint({ outcome: 'died-with', depth: 0 }), undefined)).toBe(
      'Borne by Kaelen — fell at depth 0',
    );
    expect(provenanceLine(stint({ outcome: 'escaped-with', depth: 0 }), 'refused')).toBe(
      'Borne by Kaelen — refused the Deep with it at depth 0',
    );
  });

  it("overrides an escaped-with stint's text from the record's completion type", () => {
    expect(provenanceLine(stint({ outcome: 'escaped-with' }), 'became-heart')).toBe(
      'Borne by Kaelen — was bound into the Heart with it at depth 14',
    );
    expect(provenanceLine(stint({ outcome: 'escaped-with' }), 'broke-cycle')).toBe(
      'Borne by Kaelen — broke the cycle with it at depth 14',
    );
    expect(provenanceLine(stint({ outcome: 'escaped-with' }), 'refused')).toBe(
      'Borne by Kaelen — refused the Deep with it at depth 14',
    );
  });

  it('leaves every other outcome untouched by the completion type', () => {
    expect(provenanceLine(stint({ outcome: 'died-with' }), 'broke-cycle')).toBe(
      'Borne by Kaelen — fell at depth 14',
    );
    expect(provenanceLine(stint({ outcome: 'reclaimed-by-the-deep' }), 'became-heart')).toBe(
      'Borne by Kaelen — the Deep took it back at depth 14',
    );
  });
});

describe('provenanceLines', () => {
  const ledger: ArtifactLedger = [
    {
      artifactId: 'item.marias-grace',
      status: 'lost',
      holderRecordId: 'record.yrsa',
      provenance: [
        stint({ heroName: 'Kaelen', recordId: 'record.kaelen', outcome: 'escaped-with', depth: 9 }),
        stint({
          heroName: 'Kaelen',
          recordId: 'record.kaelen',
          outcome: 'reclaimed-by-the-deep',
          depth: 0,
        }),
        stint({ heroName: 'Yrsa', recordId: 'record.yrsa', outcome: 'died-with', depth: 12 }),
      ],
    },
  ];

  it('joins each stint against its record so the completion type wins where it applies', () => {
    const lines = provenanceLines(ledger, 'item.marias-grace', [
      record('record.kaelen', 'became-heart'),
      record('record.yrsa', 'died'),
    ]);

    expect(lines).toEqual([
      'Borne by Kaelen — was bound into the Heart with it at depth 9',
      'Borne by Kaelen — the Deep took it back',
      'Borne by Yrsa — fell at depth 12',
    ]);
  });

  it('falls back to the raw stint outcome when the record is not in the Hall', () => {
    expect(provenanceLines(ledger, 'item.marias-grace', [])[0]).toBe(
      'Borne by Kaelen — carried it out at depth 9',
    );
  });

  it('is empty for an item the ledger has never seen', () => {
    expect(provenanceLines(ledger, 'item.brass-lantern', [])).toEqual([]);
    expect(provenanceLines(ledger, undefined, [])).toEqual([]);
  });
});

describe('artifact detection off the pack', () => {
  it("recognizes an item carrying an artifact block, and nothing else's", () => {
    expect(isArtifact(pack, 'item.marias-grace')).toBe(true);
    expect(isArtifact(pack, 'item.brass-lantern')).toBe(false);
    expect(isArtifact(pack, undefined)).toBe(false);
    expect(isArtifact(pack, 'item.does-not-exist')).toBe(false);
  });

  it("exposes the artifact block itself, so callers read the content's own numbers", () => {
    expect(artifactOf(pack, 'item.marias-grace')?.light).toEqual({
      fuelless: true,
      inextinguishable: true,
    });
    expect(artifactOf(pack, 'item.brass-lantern')).toBeUndefined();
  });

  it('hides the fuel gauge only for a fuelless artifact light', () => {
    // The fuelless instance still HOLDS fuel (`fuel: fuelCapacity`), so the pack's `light.fuelless`
    // flag -- never `fuel === null` -- is the only correct gate.
    expect(isFuellessLight(pack, 'item.marias-grace')).toBe(true);
    expect(isFuellessLight(pack, 'item.brass-lantern')).toBe(false);
    expect(isFuellessLight(pack, 'item.bound-signet')).toBe(false);
    expect(isFuellessLight(pack, undefined)).toBe(false);
  });

  it('lists the drawback modifiers as signed rows in a stable order', () => {
    expect(artifactDrawbackRows(pack, 'item.thread-counts-needle')).toEqual([
      { label: 'maxHealth', value: '-2' },
    ]);
    expect(artifactDrawbackRows(pack, 'item.marias-grace')).toEqual([]);
    expect(artifactDrawbackRows(pack, 'item.brass-lantern')).toEqual([]);
  });
});

describe('relicsOverview', () => {
  it('names every ledger relic with its last stint and counts the rest as unfound', () => {
    // Ledger order (the engine sorts entries by artifact id) is what the panel renders in.
    const ledger: ArtifactLedger = [
      {
        artifactId: 'item.bound-signet',
        status: 'undiscovered',
        holderRecordId: null,
        provenance: [
          stint({ heroName: 'Ada', recordId: 'record.ada', outcome: 'escaped-with', depth: 20 }),
        ],
      },
      {
        artifactId: 'item.marias-grace',
        status: 'lost',
        holderRecordId: 'record.yrsa',
        provenance: [
          stint({ heroName: 'Yrsa', recordId: 'record.yrsa', outcome: 'died-with', depth: 12 }),
        ],
      },
    ];

    const overview = relicsOverview(pack, ledger, [record('record.ada', 'broke-cycle')]);

    expect(overview.known).toEqual([
      {
        artifactId: 'item.bound-signet',
        name: 'Bound signet',
        lastStint: 'Borne by Ada — broke the cycle with it at depth 20',
      },
      {
        artifactId: 'item.marias-grace',
        name: "Maria's Grace",
        lastStint: 'Borne by Yrsa — fell at depth 12',
      },
    ]);
    expect(overview.undiscoveredCount).toBe(overview.artifactCount - 2);
    expect(overview.artifactCount).toBeGreaterThan(2);
  });

  it('counts every artifact as unfound for an untouched ledger', () => {
    const overview = relicsOverview(pack, [], []);
    expect(overview.known).toEqual([]);
    expect(overview.undiscoveredCount).toBe(overview.artifactCount);
  });
});
