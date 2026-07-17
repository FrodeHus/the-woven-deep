import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import type { CompiledContentPack } from '@woven-deep/content';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import {
  DEFAULT_GUEST_HERO, createNewRun, projectGameplayState, type ActiveRun, type GameplayProjection,
} from '@woven-deep/engine';
import type { LogLine } from '../src/session/event-log.js';
import type { SessionSnapshot } from '../src/session/guest-session.js';
import { JOURNAL_OBJECTIVE, MapJournalOverlay } from '../src/ui/overlays/MapJournalOverlay.js';

let pack: CompiledContentPack;
let baseRun: ActiveRun;
let baseProjection: GameplayProjection;

const SEED = [11, 22, 33, 44] as const;

beforeAll(async () => {
  pack = await compileContentDirectory({ rootDir: resolve(import.meta.dirname, '../../../content') });
  baseRun = createNewRun({ pack, seed: SEED, hero: DEFAULT_GUEST_HERO });
  baseProjection = projectGameplayState({ state: baseRun, content: pack });
});

interface FloorOverrides {
  readonly floorId?: string;
  readonly town?: boolean;
  readonly width: number;
  readonly height: number;
  readonly cells: readonly Readonly<{
    index: number; x: number; y: number;
    knowledge: 'unknown' | 'remembered' | 'visible';
    tileId?: number; glyph?: string; intensity: number; tint?: readonly [number, number, number];
  }>[];
}

interface PersistedLandmarkOverride {
  readonly floorId: string;
  readonly kind: 'merchant' | 'stair-up' | 'stair-down' | 'house';
  readonly name: string;
  readonly x: number;
  readonly y: number;
}

interface SnapshotOverrides {
  readonly floor?: FloorOverrides;
  readonly hero?: Readonly<{ x: number; y: number }>;
  readonly actors?: readonly Readonly<Record<string, unknown>>[];
  readonly slots?: readonly Readonly<{ slotId: string; tags: readonly string[]; x: number; y: number }>[];
  readonly log?: readonly LogLine[];
  readonly landmarks?: readonly PersistedLandmarkOverride[];
}

function snapshotWith(overrides: SnapshotOverrides): SessionSnapshot {
  return {
    projection: {
      ...baseProjection,
      floor: overrides.floor ?? baseProjection.floor,
      hero: { ...baseProjection.hero, ...(overrides.hero ?? {}) },
      actors: overrides.actors ?? [],
      slots: overrides.slots ?? [],
    } as unknown as GameplayProjection,
    log: overrides.log ?? [],
    lastEvents: [],
    pendingDecision: null,
    notice: null,
    houseOpen: false,
    conclusion: null,
    sightings: { monsterIds: [], itemIds: [], landmarks: overrides.landmarks ?? [] },
    heroClassTags: [],
    onboarding: { counts: {}, dismissed: [] },
  };
}

/** A tiny 3x1 dungeon floor: cell 0 unknown (but WITH a glyph field set, to prove the component
 * ignores it rather than merely never receiving one), cell 1 remembered (a wall, `#`), cell 2
 * visible (open floor, `.`) -- the hero stands there. */
const MIXED_KNOWLEDGE_FLOOR: FloorOverrides = {
  town: false, width: 3, height: 1,
  cells: [
    { index: 0, x: 0, y: 0, knowledge: 'unknown', intensity: 0, glyph: 'Z' },
    { index: 1, x: 1, y: 0, knowledge: 'remembered', tileId: 1, glyph: '#', intensity: 24 },
    { index: 2, x: 2, y: 0, knowledge: 'visible', tileId: 0, glyph: '.', intensity: 200, tint: [10, 20, 30] },
  ],
};

describe('MapJournalOverlay', () => {
  describe('map tab', () => {
    it('renders exactly the known subset of a mixed-knowledge floor: the unknown cell shows no glyph at all', () => {
      const snapshot = snapshotWith({ floor: MIXED_KNOWLEDGE_FLOOR, hero: { x: 2, y: 0 } });
      const { container } = render(<MapJournalOverlay snapshot={snapshot} />);

      const grid = screen.getByRole('grid', { name: /floor map/i });
      // The unknown cell's own glyph ('Z') must never appear anywhere in the map markup, even
      // though the fixture cell object carries it -- proving the component branches on
      // `knowledge`, not merely on whether a glyph happens to be present.
      expect(within(grid).queryByText('Z')).not.toBeInTheDocument();
      expect(container.querySelectorAll('.map-cell-unknown')).toHaveLength(1);
      // The remembered wall glyph is shown (dim), reused verbatim from the cell.
      expect(within(grid).getByText('#')).toBeInTheDocument();
      expect(container.querySelector('.map-cell-remembered')).toHaveTextContent('#');
    });

    it('marks the hero position on its visible cell', () => {
      const snapshot = snapshotWith({ floor: MIXED_KNOWLEDGE_FLOOR, hero: { x: 2, y: 0 } });
      render(<MapJournalOverlay snapshot={snapshot} />);
      expect(screen.getByText('@')).toBeInTheDocument();
      expect(screen.getByLabelText('Hero at 2, 0')).toHaveTextContent('@');
    });

    it('shows an actor glyph only on its own visible cell -- never leaking onto an unknown/remembered cell', () => {
      const floorWithActor: FloorOverrides = {
        ...MIXED_KNOWLEDGE_FLOOR,
        cells: MIXED_KNOWLEDGE_FLOOR.cells.map((cell) => (cell.x === 2 ? { ...cell } : cell)),
      };
      // The hero moves off (2,0) so the actor's own glyph, not '@', is what proves through.
      const snapshot = snapshotWith({
        floor: floorWithActor,
        hero: { x: 2, y: 0 },
        actors: [{ actorId: 'actor.rat', x: 1, y: 0, glyph: 'r' }],
      });
      // The actor sits on the REMEMBERED cell (x=1) in this fixture, which is not how the real
      // engine ever projects actors (visible-only by construction) -- proving the overlay itself
      // never paints an actor glyph outside a visible cell, even if one were (incorrectly) handed
      // to it, is the point of this assertion.
      const { container } = render(<MapJournalOverlay snapshot={snapshot} />);
      expect(container.querySelector('.map-cell-remembered')).toHaveTextContent('#');
      expect(screen.queryByText('r')).not.toBeInTheDocument();
    });

    it('paints a visible actor glyph on its cell', () => {
      const snapshot = snapshotWith({
        floor: MIXED_KNOWLEDGE_FLOOR,
        hero: { x: 0, y: 0 }, // irrelevant to this assertion; not on the visible cell
        actors: [{ actorId: 'actor.rat', x: 2, y: 0, glyph: 'r' }],
      });
      const { container } = render(<MapJournalOverlay snapshot={snapshot} />);
      expect(container.querySelector('.map-cell-visible')).toHaveTextContent('r');
    });

    it('reuses the cell glyph verbatim for stairs -- no re-derivation', () => {
      const stairFloor: FloorOverrides = {
        town: false, width: 1, height: 1,
        cells: [{ index: 0, x: 0, y: 0, knowledge: 'visible', tileId: 5, glyph: '>', intensity: 200 }],
      };
      const snapshot = snapshotWith({ floor: stairFloor, hero: { x: 5, y: 5 } });
      render(<MapJournalOverlay snapshot={snapshot} />);
      expect(screen.getByText('>')).toBeInTheDocument();
    });
  });

  describe('tab switching', () => {
    it('opens on the map tab by default, and ArrowRight/ArrowLeft on the tablist cycle to journal and back', async () => {
      const user = userEvent.setup();
      const snapshot = snapshotWith({ floor: MIXED_KNOWLEDGE_FLOOR, hero: { x: 2, y: 0 } });
      render(<MapJournalOverlay snapshot={snapshot} />);

      expect(screen.getByRole('grid', { name: /floor map/i })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: 'Map' })).toHaveAttribute('aria-selected', 'true');

      const tablist = screen.getByRole('tablist', { name: /map and journal/i });
      tablist.focus();
      await user.keyboard('{ArrowRight}');

      expect(screen.queryByRole('grid', { name: /floor map/i })).not.toBeInTheDocument();
      expect(screen.getByText(JOURNAL_OBJECTIVE)).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: 'Journal' })).toHaveAttribute('aria-selected', 'true');

      await user.keyboard('{ArrowLeft}');
      expect(screen.getByRole('grid', { name: /floor map/i })).toBeInTheDocument();
    });

    it('links each tab to its panel via aria-controls/id and gives each panel role="tabpanel" with aria-labelledby back to its tab', () => {
      const snapshot = snapshotWith({ floor: MIXED_KNOWLEDGE_FLOOR, hero: { x: 2, y: 0 } });
      render(<MapJournalOverlay snapshot={snapshot} />);

      const mapTab = screen.getByRole('tab', { name: 'Map' });
      const journalTab = screen.getByRole('tab', { name: 'Journal' });
      const panels = screen.getAllByRole('tabpanel', { hidden: true });
      expect(panels).toHaveLength(1);
      const [visiblePanel] = panels;

      const mapTabId = mapTab.getAttribute('id');
      const journalTabId = journalTab.getAttribute('id');
      expect(mapTabId).toBeTruthy();
      expect(journalTabId).toBeTruthy();

      const mapControls = mapTab.getAttribute('aria-controls');
      expect(mapControls).toBeTruthy();
      expect(visiblePanel).toHaveAttribute('id', mapControls);
      expect(visiblePanel).toHaveAttribute('aria-labelledby', mapTabId);
    });

    it('moves DOM focus to the newly-active tab on ArrowRight, using roving tabindex (active=0, inactive=-1)', async () => {
      const user = userEvent.setup();
      const snapshot = snapshotWith({ floor: MIXED_KNOWLEDGE_FLOOR, hero: { x: 2, y: 0 } });
      render(<MapJournalOverlay snapshot={snapshot} />);

      const mapTab = screen.getByRole('tab', { name: 'Map' });
      const journalTab = screen.getByRole('tab', { name: 'Journal' });
      expect(mapTab).toHaveAttribute('tabIndex', '0');
      expect(journalTab).toHaveAttribute('tabIndex', '-1');

      mapTab.focus();
      await user.keyboard('{ArrowRight}');

      expect(document.activeElement).toBe(journalTab);
      expect(journalTab).toHaveAttribute('tabIndex', '0');
      expect(mapTab).toHaveAttribute('tabIndex', '-1');
    });

    it('also switches tabs by clicking', async () => {
      const user = userEvent.setup();
      const snapshot = snapshotWith({ floor: MIXED_KNOWLEDGE_FLOOR, hero: { x: 2, y: 0 } });
      render(<MapJournalOverlay snapshot={snapshot} />);

      await user.click(screen.getByRole('tab', { name: 'Journal' }));
      expect(screen.getByText(JOURNAL_OBJECTIVE)).toBeInTheDocument();
    });
  });

  describe('journal tab', () => {
    function logLines(count: number): readonly LogLine[] {
      return Array.from({ length: count }, (_unused, index) => (
        { id: index, text: `Log line number ${index}`, tone: 'info' as const }
      ));
    }

    it('shows the full retained log history -- more than the 8-line conclusion tail -- proving the source is the full retention', async () => {
      const user = userEvent.setup();
      const snapshot = snapshotWith({ floor: MIXED_KNOWLEDGE_FLOOR, log: logLines(12) });
      render(<MapJournalOverlay snapshot={snapshot} />);
      await user.click(screen.getByRole('tab', { name: 'Journal' }));

      const log = screen.getByRole('list', { name: /adventure log/i });
      const lines = within(log).getAllByRole('listitem');
      expect(lines.length).toBe(12);
      expect(lines.length).toBeGreaterThan(8);
      // Newest last.
      expect(lines[0]).toHaveTextContent('Log line number 0');
      expect(lines[11]).toHaveTextContent('Log line number 11');
    });

    it('lists the town\'s three merchant slots and the house door as landmarks', async () => {
      const user = userEvent.setup();
      const townFloor: FloorOverrides = { town: true, width: 1, height: 1, cells: [] };
      const townSlots = [
        { slotId: 'slot.town-test.house-door', tags: ['town', 'house-door'], x: 1, y: 1 },
        { slotId: 'slot.town-test.merchant-provisioner', tags: ['town', 'merchant', 'provisioner'], x: 2, y: 2 },
        { slotId: 'slot.town-test.merchant-arms', tags: ['town', 'merchant', 'arms'], x: 3, y: 3 },
        { slotId: 'slot.town-test.merchant-curios', tags: ['town', 'merchant', 'curios'], x: 4, y: 4 },
      ];
      const snapshot = snapshotWith({ floor: townFloor, slots: townSlots });
      render(<MapJournalOverlay snapshot={snapshot} />);
      await user.click(screen.getByRole('tab', { name: 'Journal' }));

      const landmarks = within(screen.getByRole('list', { name: /landmarks/i }));
      expect(landmarks.getByText(/the house/i)).toBeInTheDocument();
      expect(landmarks.getByText(/provisioner/i)).toBeInTheDocument();
      expect(landmarks.getByText(/arms/i)).toBeInTheDocument();
      expect(landmarks.getByText(/curios/i)).toBeInTheDocument();
    });

    it('lists the stair-down as a landmark once its cell is seen in a dungeon floor', async () => {
      const user = userEvent.setup();
      const dungeonFloor: FloorOverrides = {
        town: false, width: 1, height: 1,
        cells: [{ index: 0, x: 0, y: 0, knowledge: 'remembered', tileId: 5, glyph: '>', intensity: 24 }],
      };
      const snapshot = snapshotWith({ floor: dungeonFloor, hero: { x: 5, y: 5 } });
      render(<MapJournalOverlay snapshot={snapshot} />);
      await user.click(screen.getByRole('tab', { name: 'Journal' }));

      const landmarks = within(screen.getByRole('list', { name: /landmarks/i }));
      expect(landmarks.getByText(/stairs down/i)).toBeInTheDocument();
      expect(landmarks.queryByText(/stairs up/i)).not.toBeInTheDocument();
    });

    it('shows a persisted merchant landmark on the current floor even though no actor is currently visible', async () => {
      const user = userEvent.setup();
      const dungeonFloor: FloorOverrides = { floorId: 'floor.dungeon-1', town: false, width: 1, height: 1, cells: [] };
      const snapshot = snapshotWith({
        floor: dungeonFloor,
        landmarks: [{ floorId: 'floor.dungeon-1', kind: 'merchant', name: 'Wandering Peddler', x: 5, y: 5 }],
      });
      render(<MapJournalOverlay snapshot={snapshot} />);
      await user.click(screen.getByRole('tab', { name: 'Journal' }));

      const landmarks = within(screen.getByRole('list', { name: /landmarks/i }));
      expect(landmarks.getByText(/wandering peddler/i)).toBeInTheDocument();
    });

    it('does not duplicate a landmark that is both currently live and already persisted', async () => {
      const user = userEvent.setup();
      const dungeonFloor: FloorOverrides = {
        floorId: 'floor.dungeon-1', town: false, width: 1, height: 1,
        cells: [{ index: 0, x: 5, y: 5, knowledge: 'visible', tileId: 1, glyph: '.', intensity: 200 }],
      };
      const snapshot = snapshotWith({
        floor: dungeonFloor,
        hero: { x: 0, y: 0 },
        actors: [{ x: 5, y: 5, name: 'Wandering Peddler', factionName: 'faction.lampwrights' }],
        landmarks: [{ floorId: 'floor.dungeon-1', kind: 'merchant', name: 'Wandering Peddler', x: 5, y: 5 }],
      });
      render(<MapJournalOverlay snapshot={snapshot} />);
      await user.click(screen.getByRole('tab', { name: 'Journal' }));

      const landmarks = within(screen.getByRole('list', { name: /landmarks/i }));
      expect(landmarks.getAllByText(/wandering peddler/i)).toHaveLength(1);
    });

    it('dedupes a moving merchant by identity, not position -- a persisted landmark frozen at first-seen (x,y) collapses into the live entry at the merchant\'s current position', async () => {
      const user = userEvent.setup();
      const dungeonFloor: FloorOverrides = {
        floorId: 'floor.dungeon-1', town: false, width: 1, height: 1,
        cells: [{ index: 0, x: 12, y: 10, knowledge: 'visible', tileId: 1, glyph: '.', intensity: 200 }],
      };
      const snapshot = snapshotWith({
        floor: dungeonFloor,
        hero: { x: 0, y: 0 },
        // The merchant fled from (10,10) -- where it was first captured -- to (12,10), its
        // current, live position.
        actors: [{ x: 12, y: 10, name: 'Weary Lampwright', factionName: 'faction.lampwrights' }],
        landmarks: [{ floorId: 'floor.dungeon-1', kind: 'merchant', name: 'Weary Lampwright', x: 10, y: 10 }],
      });
      render(<MapJournalOverlay snapshot={snapshot} />);
      await user.click(screen.getByRole('tab', { name: 'Journal' }));

      const landmarks = within(screen.getByRole('list', { name: /landmarks/i }));
      expect(landmarks.getAllByText(/weary lampwright/i)).toHaveLength(1);
    });

    it('keeps two rows for two different merchants at two different positions', async () => {
      const user = userEvent.setup();
      const dungeonFloor: FloorOverrides = { floorId: 'floor.dungeon-1', town: false, width: 1, height: 1, cells: [] };
      const snapshot = snapshotWith({
        floor: dungeonFloor,
        actors: [{ x: 12, y: 10, name: 'Weary Lampwright', factionName: 'faction.lampwrights' }],
        landmarks: [{ floorId: 'floor.dungeon-1', kind: 'merchant', name: 'Wandering Peddler', x: 5, y: 5 }],
      });
      render(<MapJournalOverlay snapshot={snapshot} />);
      await user.click(screen.getByRole('tab', { name: 'Journal' }));

      const landmarks = within(screen.getByRole('list', { name: /landmarks/i }));
      expect(landmarks.getByText(/weary lampwright/i)).toBeInTheDocument();
      expect(landmarks.getByText(/wandering peddler/i)).toBeInTheDocument();
    });

    it('does not show a persisted landmark captured on a DIFFERENT floor', async () => {
      const user = userEvent.setup();
      const dungeonFloor: FloorOverrides = { floorId: 'floor.dungeon-2', town: false, width: 1, height: 1, cells: [] };
      const snapshot = snapshotWith({
        floor: dungeonFloor,
        landmarks: [{ floorId: 'floor.dungeon-1', kind: 'merchant', name: 'Wandering Peddler', x: 5, y: 5 }],
      });
      render(<MapJournalOverlay snapshot={snapshot} />);
      await user.click(screen.getByRole('tab', { name: 'Journal' }));

      expect(screen.queryByRole('list', { name: /landmarks/i })).not.toBeInTheDocument();
      expect(screen.queryByText(/wandering peddler/i)).not.toBeInTheDocument();
      expect(screen.getByText('Nothing landmark-worthy seen yet.')).toBeInTheDocument();
    });
  });
});
