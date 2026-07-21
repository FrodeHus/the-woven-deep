import { resolve } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import type { CompiledContentPack } from '@woven-deep/content';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import {
  createNewRun,
  DEFAULT_GUEST_HERO,
  descendToNextFloor,
  encodeActiveRun,
  FINAL_CHAMBER_DEPTH,
  heroActor,
  isHeartBossActive,
  tabletFragmentIds,
  validateActiveRun,
  type ActiveRun,
  type HeartLineageRecord,
  type ItemInstance,
  type Uint32State,
} from '@woven-deep/engine';
import { GuestSession } from '../src/session/guest-session.js';
import { FinalChamberChoice } from '../src/ui/overlays/FinalChamberChoice.js';
import { SAVE_KEY, type SessionStorageLike } from '../src/session/storage.js';

let pack: CompiledContentPack;

const SEED: Uint32State = [7, 14, 21, 28];

beforeAll(async () => {
  pack = await compileContentDirectory({
    rootDir: resolve(import.meta.dirname, '../../../content'),
  });
});

// Building a Chamber-floor `ActiveRun` walks 19 real floor transitions (`descendToDepth19`)
// before each test even mounts a component -- comfortably under the default 5s test timeout in
// isolation, but the full suite's contention can push it over, so every test below passes this
// explicitly as its own timeout.
const CHAMBER_TEST_TIMEOUT = 20_000;

function fakeStorage(): SessionStorageLike {
  const values = new Map<string, string>();
  return {
    get: (key: string) => values.get(key) ?? null,
    set: (key: string, value: string) => {
      values.set(key, value);
    },
    remove: (key: string) => {
      values.delete(key);
    },
  };
}

function teleportHeroTo(run: ActiveRun, position: Readonly<{ x: number; y: number }>): ActiveRun {
  const hero = heroActor(run);
  return validateActiveRun({
    ...run,
    actors: run.actors.map((actor) =>
      actor.actorId === hero.actorId ? { ...actor, x: position.x, y: position.y } : actor,
    ),
  });
}

/** Descends from a fresh run all the way to depth 19, teleporting onto each floor's stair-down. */
function descendToDepth19(run: ActiveRun): ActiveRun {
  let state = run;
  for (;;) {
    const activeFloor = state.floors.find((floor) => floor.floorId === state.activeFloorId);
    if (!activeFloor) throw new Error('test setup failure: active floor missing');
    if (activeFloor.depth >= 19) return state;
    const stairDown = activeFloor.stairDown;
    if (!stairDown) throw new Error('test setup failure: floor has no stair-down');
    state = descendToNextFloor(teleportHeroTo(state, stairDown), { content: pack }).state;
  }
}

// A run with the hero standing in the Final Chamber. Reaching it walks 20 real floor
// transitions (~10s), so cache the deterministic result and reuse it: the run is immutable
// and every test derives new state functionally, never mutating this base. Without the cache
// each test re-descends and the file runs long enough to outlast Vitest's 60s worker-RPC
// heartbeat on a 2-core CI runner.
let cachedChamberRun: ActiveRun | undefined;
function inChamberRun(): ActiveRun {
  if (cachedChamberRun !== undefined) return cachedChamberRun;
  const atDepth19 = descendToDepth19(createNewRun({ pack, seed: SEED, hero: DEFAULT_GUEST_HERO }));
  const activeFloor = atDepth19.floors.find((floor) => floor.floorId === atDepth19.activeFloorId)!;
  const onStairs = teleportHeroTo(atDepth19, activeFloor.stairDown!);
  cachedChamberRun = descendToNextFloor(onStairs, { content: pack }).state;
  return cachedChamberRun;
}

function fragmentInstance(contentId: string, hero: ActiveRun['hero']): ItemInstance {
  return {
    itemId: `${contentId}.instance`,
    contentId,
    quantity: 1,
    condition: 100,
    enchantment: null,
    identified: true,
    charges: null,
    fuel: null,
    enabled: null,
    location: { type: 'backpack', actorId: hero.actorId },
  };
}

function withAllFragments(run: ActiveRun): ActiveRun {
  const fragmentIds = tabletFragmentIds(pack);
  const items = [...run.items, ...fragmentIds.map((id) => fragmentInstance(id, run.hero))].sort(
    (left, right) => (left.itemId < right.itemId ? -1 : left.itemId > right.itemId ? 1 : 0),
  );
  return { ...run, items };
}

/** Boots a real `GuestSession` restored from the given run, exactly like `guest-session.test.ts`
 * pre-seeds storage for a restore. */
function sessionFor(run: ActiveRun): GuestSession {
  const storage = fakeStorage();
  storage.set(SAVE_KEY, encodeActiveRun(run));
  return new GuestSession({ pack, storage });
}

const predecessor: HeartLineageRecord = {
  heroName: 'Ysolde',
  classTags: ['warden'],
  hallRecordId: 'record.predecessor',
  enrichment: { achievedAt: 'Run #1', portraitGlyph: '@' },
};

describe('FinalChamberChoice', () => {
  it(
    'appears once the hero reaches the Chamber floor',
    () => {
      const session = sessionFor(inChamberRun());
      expect(session.getSnapshot().projection.floor.depth).toBe(FINAL_CHAMBER_DEPTH);

      render(
        <FinalChamberChoice
          session={session}
          snapshot={session.getSnapshot()}
          currentHeart={null}
        />,
      );

      expect(screen.getByRole('dialog', { name: /final chamber/i })).toBeInTheDocument();
    },
    CHAMBER_TEST_TIMEOUT,
  );

  it(
    'offers only Become the Heart and Turn away without the full fragment set',
    () => {
      const session = sessionFor(inChamberRun());
      render(
        <FinalChamberChoice
          session={session}
          snapshot={session.getSnapshot()}
          currentHeart={null}
        />,
      );

      expect(screen.getByRole('button', { name: /become the heart/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /turn away/i })).toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: /assemble the tablet/i }),
      ).not.toBeInTheDocument();
    },
    CHAMBER_TEST_TIMEOUT,
  );

  it(
    'offers all three choices once the hero holds the full fragment set',
    () => {
      const session = sessionFor(withAllFragments(inChamberRun()));
      render(
        <FinalChamberChoice
          session={session}
          snapshot={session.getSnapshot()}
          currentHeart={null}
        />,
      );

      expect(screen.getByRole('button', { name: /become the heart/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /turn away/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /assemble the tablet/i })).toBeInTheDocument();
    },
    CHAMBER_TEST_TIMEOUT,
  );

  it(
    'shows the predecessor Heart by name and class when the lineage store has one',
    () => {
      const session = sessionFor(inChamberRun());
      render(
        <FinalChamberChoice
          session={session}
          snapshot={session.getSnapshot()}
          currentHeart={predecessor}
        />,
      );

      expect(screen.getByText(/Ysolde/)).toBeInTheDocument();
      expect(screen.getByText(/warden/)).toBeInTheDocument();
    },
    CHAMBER_TEST_TIMEOUT,
  );

  it(
    'shows the authored fallback identity when the lineage store is empty',
    () => {
      const session = sessionFor(inChamberRun());
      render(
        <FinalChamberChoice
          session={session}
          snapshot={session.getSnapshot()}
          currentHeart={null}
        />,
      );

      expect(screen.getByText(/ancestral heart/i)).toBeInTheDocument();
    },
    CHAMBER_TEST_TIMEOUT,
  );

  it(
    'dispatches become-heart and concludes the run with became-heart',
    async () => {
      const user = userEvent.setup();
      const session = sessionFor(inChamberRun());
      const { rerender } = render(
        <FinalChamberChoice
          session={session}
          snapshot={session.getSnapshot()}
          currentHeart={null}
        />,
      );

      await user.click(screen.getByRole('button', { name: /become the heart/i }));
      rerender(
        <FinalChamberChoice
          session={session}
          snapshot={session.getSnapshot()}
          currentHeart={null}
        />,
      );

      expect(session.getSnapshot().conclusion?.completionType).toBe('became-heart');
    },
    CHAMBER_TEST_TIMEOUT,
  );

  it(
    'dispatches turn-away, which activates the boss fight rather than concluding the run',
    async () => {
      const user = userEvent.setup();
      const session = sessionFor(inChamberRun());
      render(
        <FinalChamberChoice
          session={session}
          snapshot={session.getSnapshot()}
          currentHeart={null}
        />,
      );

      await user.click(screen.getByRole('button', { name: /turn away/i }));

      expect(session.getSnapshot().conclusion).toBeNull();
      const run = (session as unknown as { run: ActiveRun }).run;
      expect(isHeartBossActive(run)).toBe(true);
    },
    CHAMBER_TEST_TIMEOUT,
  );

  it(
    'dispatches break-cycle and concludes the run with broke-cycle',
    async () => {
      const user = userEvent.setup();
      const session = sessionFor(withAllFragments(inChamberRun()));
      render(
        <FinalChamberChoice
          session={session}
          snapshot={session.getSnapshot()}
          currentHeart={null}
        />,
      );

      await user.click(screen.getByRole('button', { name: /assemble the tablet/i }));

      expect(session.getSnapshot().conclusion?.completionType).toBe('broke-cycle');
    },
    CHAMBER_TEST_TIMEOUT,
  );

  it(
    'a plain move onto the Heart cell never itself dispatches a choice',
    () => {
      const chooseSpy = vi.fn();
      const session = sessionFor(inChamberRun());
      (session as unknown as { chooseFinalChamber: typeof chooseSpy }).chooseFinalChamber =
        chooseSpy;

      // The vault authors the Heart two floor-cells north of the hero's entry stair (see
      // `content/vaults/final-chamber.yaml`): walking there is an ordinary move, not a choice.
      session.dispatch({ type: 'move', direction: 'north' });
      session.dispatch({ type: 'move', direction: 'north' });

      expect(chooseSpy).not.toHaveBeenCalled();
      expect(session.getSnapshot().conclusion).toBeNull();
      expect(session.getSnapshot().pendingFinalChamberChoice).not.toBeNull();
    },
    CHAMBER_TEST_TIMEOUT,
  );
});
