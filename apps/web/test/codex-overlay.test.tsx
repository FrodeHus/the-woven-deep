import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import type { CompiledContentPack } from '@woven-deep/content';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import type { StoredHallRecord } from '@woven-deep/engine';
import { emptyRunMetrics } from '@woven-deep/engine';
import { CodexOverlay } from '../src/ui/overlays/CodexOverlay.js';
import type { Sightings } from '../src/session/codex.js';

let pack: CompiledContentPack;

beforeAll(async () => {
  pack = await compileContentDirectory({ rootDir: resolve(import.meta.dirname, '../../../content') });
});

const EMPTY_SIGHTINGS: Sightings = { monsterIds: [], itemIds: [], landmarks: [] };

function record(overrides: Partial<StoredHallRecord> = {}): StoredHallRecord {
  return {
    recordId: 'record.aaaaaaaa00000000.aaaaaaaaaaaaaaaa',
    heroName: 'Ada',
    classTags: ['wayfarer'],
    completionType: 'died',
    cause: { killerContentId: 'monster.cave-rat', depth: 3, turn: 12, worldTime: 12 },
    deepestDepth: 3,
    score: { lines: [], total: 40 },
    metrics: emptyRunMetrics(),
    reputations: [],
    heirloom: {
      contentId: 'item.iron-sword', sourceItemId: null, enchantment: null, condition: 100,
      charges: null, fuel: null, qualityRank: 1, displayName: "Ada's Iron Sword",
      glyph: ')', color: '#d8d8d8', originatingHallRecordId: 'record.aaaaaaaa00000000.aaaaaaaaaaaaaaaa',
    },
    build: {
      attributes: { might: 14, agility: 12, vitality: 16, wits: 10, resolve: 12 },
      equippedItemContentIds: ['item.iron-sword'],
      signatureAbilityIds: [],
    },
    runSeed: 'aaaaaaaa00000000',
    contentHash: 'b'.repeat(64),
    enrichment: { achievedAt: 'Run #1', portraitGlyph: '@' },
    ...overrides,
  };
}

describe('CodexOverlay', () => {
  it('opens on the class tab, and switches tabs with ArrowRight/ArrowLeft', () => {
    render(<CodexOverlay records={[]} snapshot={null} sightings={EMPTY_SIGHTINGS} pack={pack} />);

    expect(screen.getByRole('tab', { name: 'Classes' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getAllByRole('tabpanel')).toHaveLength(1); // exactly one panel rendered at a time

    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: 'Items' })).toHaveAttribute('aria-selected', 'true');

    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: 'Spells' })).toHaveAttribute('aria-selected', 'true');

    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: 'Monsters' })).toHaveAttribute('aria-selected', 'true');

    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowLeft' });
    expect(screen.getByRole('tab', { name: 'Spells' })).toHaveAttribute('aria-selected', 'true');
  });

  it('shows a discovered monster\'s name and glyph in the list and detail pane', () => {
    render(<CodexOverlay records={[record()]} snapshot={null} sightings={EMPTY_SIGHTINGS} pack={pack} />);
    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowLeft' }); // -> monster (wraps from class)

    const list = screen.getByRole('listbox', { name: 'Monsters' });
    expect(within(list).getByText('Cave rat', { exact: false })).toBeInTheDocument();
  });

  it('renders undiscovered entries as "???" with no content id/name anywhere in the DOM (whole-overlay serialization)', () => {
    const { container } = render(
      <CodexOverlay records={[]} snapshot={null} sightings={EMPTY_SIGHTINGS} pack={pack} />,
    );
    // Monster tab: nothing has been sighted or killed -- every entry is undiscovered.
    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowLeft' });
    const html = container.innerHTML;
    expect(html).toContain('???');
    expect(html).not.toContain('monster.cave-rat');
    expect(html).not.toContain('Cave rat');
    expect(html).not.toContain('monster.training-beetle');
    expect(html).not.toContain('Training beetle');
  });

  it('renders the empty/fully-undiscovered spells category with its silhouette rows, not an empty-state placeholder', () => {
    render(<CodexOverlay records={[record()]} snapshot={null} sightings={EMPTY_SIGHTINGS} pack={pack} />);
    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowRight' });
    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: 'Spells' })).toHaveAttribute('aria-selected', 'true');

    const list = screen.getByRole('listbox', { name: 'Spells' });
    const options = within(list).getAllByRole('option');
    expect(options.length).toBeGreaterThan(0);
    for (const option of options) expect(option).toHaveTextContent('???');
  });

  it('shows a locked class\'s unlockHint in the detail pane, per the chargen convention', () => {
    render(<CodexOverlay records={[]} snapshot={null} sightings={EMPTY_SIGHTINGS} pack={pack} />);
    // Class tab is the default; select the Archivist row (a known-locked class).
    const list = screen.getByRole('listbox', { name: 'Classes' });
    const archivistOption = within(list).getAllByRole('option').find((option) => option.textContent?.includes('A'));
    expect(archivistOption).toBeDefined();
    fireEvent.click(within(archivistOption!).getByRole('button'));
    expect(screen.getByText(/Read three lore fragments/)).toBeInTheDocument();
  });

  it('shows the session-only footer line', () => {
    render(<CodexOverlay records={[]} snapshot={null} sightings={EMPTY_SIGHTINGS} pack={pack} />);
    expect(screen.getByText(/Session-only, like your Hall records/)).toBeInTheDocument();
  });
});
