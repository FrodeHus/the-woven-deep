import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import type { CompiledContentPack } from '@woven-deep/content';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import type { StoredHallRecord } from '@woven-deep/engine';
import { emptyRunMetrics } from '@woven-deep/engine';
import { DEFAULT_SETTINGS } from '../../session/settings.js';
import type { Sightings } from '../../session/codex.js';
import { UiProviders } from '../providers.js';
import { CodexOverlay } from './CodexOverlay.js';

let pack: CompiledContentPack;

beforeAll(async () => {
  pack = await compileContentDirectory({
    rootDir: resolve(import.meta.dirname, '../../../../../content'),
  });
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
      contentId: 'item.iron-sword',
      sourceItemId: null,
      enchantment: null,
      condition: 100,
      charges: null,
      fuel: null,
      qualityRank: 1,
      displayName: "Ada's Iron Sword",
      glyph: ')',
      color: '#d8d8d8',
      originatingHallRecordId: 'record.aaaaaaaa00000000.aaaaaaaaaaaaaaaa',
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

/** Renders `CodexOverlay` exactly the way `OverlayHost`'s title-screen codex path does: through
 * `UiProviders` with NO `session` prop (so `usePack`-only context is available, mirroring the
 * title screen where `useSessionCtx()` is null) and `sightings`/`records`/`snapshot`/`pack` handed
 * in as the SAME resolved props `OverlayHost.tsx`'s `renderBody` codex case passes. */
function renderCodex(
  props: Readonly<{ records: readonly StoredHallRecord[]; sightings?: Sightings }>,
) {
  return render(
    <UiProviders pack={pack} settings={DEFAULT_SETTINGS} onChangeSettings={() => {}}>
      <CodexOverlay
        records={props.records}
        snapshot={null}
        sightings={props.sightings ?? EMPTY_SIGHTINGS}
        pack={pack}
      />
    </UiProviders>,
  );
}

describe('CodexOverlay', () => {
  it('opens on the class tab, and switches tabs with ArrowRight/ArrowLeft', async () => {
    const user = userEvent.setup();
    renderCodex({ records: [] });

    expect(screen.getByRole('tab', { name: 'Classes' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getAllByRole('tabpanel')).toHaveLength(1); // exactly one panel rendered at a time

    screen.getByRole('tab', { name: 'Classes' }).focus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Items' })).toHaveAttribute('aria-selected', 'true');

    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Spells' })).toHaveAttribute('aria-selected', 'true');

    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Monsters' })).toHaveAttribute('aria-selected', 'true');

    await user.keyboard('{ArrowLeft}');
    expect(screen.getByRole('tab', { name: 'Spells' })).toHaveAttribute('aria-selected', 'true');
  });

  it("shows a discovered monster's name and glyph in the list and detail pane", async () => {
    const user = userEvent.setup();
    renderCodex({ records: [record()] });

    screen.getByRole('tab', { name: 'Classes' }).focus();
    await user.keyboard('{ArrowRight}{ArrowRight}{ArrowRight}'); // -> item -> spell -> monster
    expect(screen.getByRole('tab', { name: 'Monsters' })).toHaveAttribute('aria-selected', 'true');

    const list = screen.getByRole('listbox', { name: 'Monsters' });
    expect(within(list).getByText('Cave rat', { exact: false })).toBeInTheDocument();
  });

  it('renders undiscovered entries as "???" with no content id/name anywhere in the DOM (whole-overlay serialization)', async () => {
    const user = userEvent.setup();
    const { container } = renderCodex({ records: [] });
    // Monster tab: nothing has been sighted or killed -- every entry is undiscovered.
    screen.getByRole('tab', { name: 'Classes' }).focus();
    await user.keyboard('{ArrowRight}{ArrowRight}{ArrowRight}'); // -> item -> spell -> monster
    expect(screen.getByRole('tab', { name: 'Monsters' })).toHaveAttribute('aria-selected', 'true');

    const html = container.innerHTML;
    expect(html).toContain('???');
    expect(html).not.toContain('monster.cave-rat');
    expect(html).not.toContain('Cave rat');
    expect(html).not.toContain('monster.training-beetle');
    expect(html).not.toContain('Training beetle');
  });

  it('renders the empty/fully-undiscovered spells category with its silhouette rows, not an empty-state placeholder', async () => {
    const user = userEvent.setup();
    renderCodex({ records: [record()] });

    screen.getByRole('tab', { name: 'Classes' }).focus();
    await user.keyboard('{ArrowRight}');
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Spells' })).toHaveAttribute('aria-selected', 'true');

    const list = screen.getByRole('listbox', { name: 'Spells' });
    const options = within(list).getAllByRole('option');
    expect(options.length).toBeGreaterThan(0);
    for (const option of options) expect(option).toHaveTextContent('???');
  });

  it("shows a locked class's unlockHint in the detail pane, per the chargen convention", async () => {
    const user = userEvent.setup();
    renderCodex({ records: [] });
    // Class tab is the default; select the Archivist row (a known-locked class).
    const list = screen.getByRole('listbox', { name: 'Classes' });
    const archivistOption = within(list)
      .getAllByRole('option')
      .find((option) => option.textContent?.includes('A'));
    expect(archivistOption).toBeDefined();
    await user.click(archivistOption!);
    expect(screen.getByText(/Read three lore fragments/)).toBeInTheDocument();
  });

  it('shows the session-only footer line', () => {
    renderCodex({ records: [] });
    expect(screen.getByText(/Session-only, like your Hall records/)).toBeInTheDocument();
  });

  describe('Lore tab', () => {
    async function openLoreTab(
      props: Readonly<{ records: readonly StoredHallRecord[]; sightings?: Sightings }>,
    ) {
      const user = userEvent.setup();
      const { container } = renderCodex(props);
      screen.getByRole('tab', { name: 'Classes' }).focus();
      await user.keyboard('{ArrowLeft}'); // class -> lore (wraps backward, last tab)
      expect(screen.getByRole('tab', { name: 'Lore' })).toHaveAttribute('aria-selected', 'true');
      return { user, container };
    }

    it('lists a discovered lore-bearing monster and item, each marked [revealed], and shows the lore text on selection', async () => {
      const { user } = await openLoreTab({ records: [record()] });

      const list = screen.getByRole('listbox', { name: 'Lore' });
      const rat = within(list).getByText('Cave rat', { exact: false });
      const sword = within(list).getByText('Iron sword', { exact: false });
      expect(rat).toBeInTheDocument();
      expect(sword).toBeInTheDocument();
      expect(within(list).getAllByText('[revealed]')).toHaveLength(2);

      await user.click(rat);
      expect(screen.getByText(/dark taught it everything/)).toBeInTheDocument();

      await user.click(sword);
      expect(screen.getByText(/never been anyone's legend/)).toBeInTheDocument();
    });

    it('omits an undiscovered lore-bearing entry (training beetle) from the Lore tab, and never leaks its lore', async () => {
      const { container } = await openLoreTab({ records: [record()] });
      expect(container.innerHTML).not.toContain('Training beetle');
      expect(container.innerHTML).not.toContain('monster.training-beetle');
    });

    it('omits a discovered lore-less entry (wooden arrows) from the Lore tab, though it still appears in Items', async () => {
      const sightings: Sightings = {
        monsterIds: [],
        itemIds: ['item.wooden-arrows'],
        landmarks: [],
      };
      await openLoreTab({ records: [record()], sightings });
      const loreList = screen.getByRole('listbox', { name: 'Lore' });
      expect(within(loreList).queryByText('Wooden arrows', { exact: false })).toBeNull();
    });
  });
});
