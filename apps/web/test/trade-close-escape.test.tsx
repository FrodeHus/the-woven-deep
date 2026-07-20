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
  encodeActiveRun,
  heroActor,
  heroPerception,
  refreshKnowledge,
  validateActiveRun,
  type ActiveRun,
  type FloorSnapshot,
  type ItemInstance,
  type MerchantPopulation,
} from '@woven-deep/engine';
import { GuestSession } from '../src/session/guest-session.js';
import { SAVE_KEY, type SessionStorageLike } from '../src/session/storage.js';
import { PlayScreen } from '../src/ui/PlayScreen.js';
import { withUiProviders } from './with-ui-providers.js';

let pack: CompiledContentPack;

const SEED = [3, 5, 7, 9] as const;

beforeAll(async () => {
  pack = await compileContentDirectory({
    rootDir: resolve(import.meta.dirname, '../../../content'),
  });
});

function fakeStorage(): SessionStorageLike {
  const store = new Map<string, string>();
  return {
    get: (key: string) => store.get(key) ?? null,
    set: (key: string, value: string) => {
      store.set(key, value);
    },
  };
}

function townFloor(run: ActiveRun): FloorSnapshot {
  return run.floors.find((floor) => floor.floorId === run.activeFloorId)!;
}

/**
 * Teleports the hero and refreshes the active floor's knowledge in place, mirroring what a real
 * `move` command would do -- see the identical helper in `packages/engine/test/town-merchants.test.ts`.
 * A raw position edit alone leaves `knowledge` unexplored, which would fail the merchant-visibility
 * check `trade-open` depends on.
 */
function teleportHero(run: ActiveRun, position: Readonly<{ x: number; y: number }>): ActiveRun {
  const hero = heroActor(run);
  const moved: ActiveRun = {
    ...run,
    actors: run.actors.map((actor) =>
      actor.actorId === hero.actorId ? { ...actor, ...position } : actor,
    ),
  };
  const floor = townFloor(moved);
  const movedHero = heroActor(moved);
  const knowledge = refreshKnowledge({
    floor,
    hero: heroPerception(moved.hero, movedHero),
    actors: new Map(
      moved.actors
        .filter((actor) => actor.floorId === floor.floorId)
        .map((actor) => [actor.actorId, actor] as const),
    ),
  }).knowledge;
  return validateActiveRun({
    ...moved,
    floors: moved.floors.map((candidate) =>
      candidate.floorId === floor.floorId ? { ...candidate, knowledge } : candidate,
    ),
  });
}

/** Stands the hero directly beside (Chebyshev distance 1 from) the given point. */
function adjacentFreeCell(
  run: ActiveRun,
  target: Readonly<{ x: number; y: number }>,
): Readonly<{ x: number; y: number }> {
  const floor = townFloor(run);
  const occupied = new Set(
    run.actors
      .filter((actor) => actor.floorId === floor.floorId && actor.health > 0)
      .map((actor) => `${actor.x}:${actor.y}`),
  );
  for (const [dx, dy] of [
    [1, 0],
    [0, 1],
    [-1, 0],
    [0, -1],
    [1, 1],
    [-1, 1],
    [1, -1],
    [-1, -1],
  ] as const) {
    const x = target.x + dx;
    const y = target.y + dy;
    if (x < 0 || y < 0 || x >= floor.width || y >= floor.height) continue;
    if (occupied.has(`${x}:${y}`)) continue;
    return { x, y };
  }
  throw new Error(`test setup failure: cannot stand adjacent to ${target.x}:${target.y}`);
}

/** A fresh session with the hero already standing beside a town merchant, so a test can dispatch
 * `{ type: 'trade-open' }` directly without walking there first. */
function sessionAdjacentToMerchant(): GuestSession {
  const fresh = createNewRun({ pack, seed: SEED, hero: DEFAULT_GUEST_HERO });
  const merchant = fresh.populations.find(
    (population): population is MerchantPopulation => population.model === 'merchant',
  )!;
  const actor = fresh.actors.find((candidate) => candidate.actorId === merchant.actorId)!;
  const heroCell = adjacentFreeCell(fresh, actor);
  const positioned = teleportHero(fresh, heroCell);

  const storage = fakeStorage();
  storage.set(SAVE_KEY, encodeActiveRun(positioned));
  return new GuestSession({ pack, storage });
}

/** A fresh session with the hero already standing beside the town curios dealer -- the only
 * permanent town merchant offering `merchant-service.identify` (see `content/encounters/
 * town-merchants.yaml`) -- and one unidentified item in the backpack, so a test can dispatch
 * `{ type: 'trade-open' }` and reach a non-empty identify picker. Mirrors
 * `trade-screen.test.tsx`'s `runWithUnidentifiedPair`, minus the second item (this test only
 * needs one eligible target) and returning a `GuestSession` instead of a raw `ActiveRun`, since
 * this file composes the real window key dispatcher via `PlayScreen`, not `TradeScreen` directly. */
function sessionAdjacentToCuriosDealerWithUnidentifiedItem(): GuestSession {
  let run = createNewRun({ pack, seed: SEED, hero: DEFAULT_GUEST_HERO });
  const hero = heroActor(run);
  const unidentified: ItemInstance = {
    itemId: 'item.hero.test-potion-a',
    contentId: 'item.crimson-potion',
    quantity: 1,
    condition: 100,
    enchantment: null,
    identified: false,
    charges: null,
    fuel: null,
    enabled: null,
    location: { type: 'backpack', actorId: hero.actorId },
  };
  run = validateActiveRun({
    ...run,
    items: [...run.items, unidentified].sort((left, right) =>
      left.itemId < right.itemId ? -1 : 1,
    ),
  });
  const curiosDealer = run.populations.find(
    (population): population is MerchantPopulation =>
      population.model === 'merchant' && population.encounterId === 'encounter.town-curios-dealer',
  )!;
  const merchantActor = run.actors.find((actor) => actor.actorId === curiosDealer.actorId)!;
  const positioned = teleportHero(run, adjacentFreeCell(run, merchantActor));

  const storage = fakeStorage();
  storage.set(SAVE_KEY, encodeActiveRun(positioned));
  return new GuestSession({ pack, storage });
}

// Regression for the reviewer-verified bug: `TradeScreen`'s own Escape handler calls `onClose()`
// (-> `trade-close`), and the same native keydown then bubbles to `PlayScreen`'s window-level key
// dispatcher, which ALSO routes Escape for open overlays and dispatches a second `trade-close`.
// The second dispatch runs against a projection where the trade already closed, so
// `command-builder.ts`'s `buildIntent` rejects it with "There is no open trade session." -- a
// spurious system log line on every ordinary Escape-close. This test composes the real window
// listener with the real dialog (unlike `trade-screen.test.tsx`'s isolated `onClose` spy, which
// can't see the bubble to `window` at all), so it is the only place this double-dispatch is
// observable.
describe('closing trade with Escape', () => {
  it('dispatches trade-close exactly once, with no spurious rejection log line', async () => {
    const user = userEvent.setup();
    const guestSession = sessionAdjacentToMerchant();

    guestSession.dispatch({ type: 'trade-open' });
    expect(guestSession.getSnapshot().projection.trade).toBeDefined();

    render(withUiProviders(pack, <PlayScreen session={guestSession} pack={pack} />));
    expect(screen.getByRole('dialog', { name: 'Trade' })).toBeInTheDocument();

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog', { name: 'Trade' })).not.toBeInTheDocument();
    const log = screen.getByRole('log', { name: 'Adventure log' });
    expect(log).not.toHaveTextContent('There is no open trade session.');
  });

  // Task 9 gap: the identify picker's own Escape branch (`TradeScreen.tsx`) calls
  // `event.stopPropagation()` BEFORE the picker/no-picker split, so a picker-closing Escape must
  // never reach `PlayScreen`'s window-level dispatcher at all -- unlike the plain trade-close case
  // above, where the dialog has already closed by the time the (harmless, rejected) second
  // dispatch fires. Here, if `stopPropagation` were ever removed, `PlayScreen`'s window listener
  // would see `projection.trade` still defined (only the picker closed, not the trade) and
  // dispatch a REAL `trade-close`, closing the whole dialog a turn early. That failure mode is
  // silent from the log's perspective (no rejection -- the trade-close would actually succeed),
  // so this test asserts directly against dialog presence and dispatch counts rather than log
  // text, and composes the real window listener + real dialog the same way the test above does,
  // since `trade-screen.test.tsx`'s isolated `onClose` spy can't see the bubble to `window` either.
  it('closes only the identify picker on the first Escape, leaving the trade dialog open, then closes the trade on the second', async () => {
    const user = userEvent.setup();
    const guestSession = sessionAdjacentToCuriosDealerWithUnidentifiedItem();

    guestSession.dispatch({ type: 'trade-open' });
    expect(guestSession.getSnapshot().projection.trade).toBeDefined();
    const dispatchSpy = vi.spyOn(guestSession, 'dispatch');

    render(withUiProviders(pack, <PlayScreen session={guestSession} pack={pack} />));
    expect(screen.getByRole('dialog', { name: 'Trade' })).toBeInTheDocument();

    await user.keyboard('{Tab}{Tab}'); // buy -> sell -> services
    await user.keyboard('{Enter}'); // opens the identify picker (one eligible target)
    expect(screen.getByRole('listbox', { name: 'Identify target' })).toBeInTheDocument();

    await user.keyboard('{Escape}');

    // The picker closed, but the trade dialog itself must still be open -- and no trade-close was
    // dispatched at all (not even one that would later be rejected).
    expect(screen.queryByRole('listbox', { name: 'Identify target' })).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Trade' })).toBeInTheDocument();
    expect(dispatchSpy).not.toHaveBeenCalledWith({ type: 'trade-close' });
    const log = screen.getByRole('log', { name: 'Adventure log' });
    expect(log).not.toHaveTextContent('There is no open trade session.');

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog', { name: 'Trade' })).not.toBeInTheDocument();
    expect(dispatchSpy.mock.calls.filter(([intent]) => intent.type === 'trade-close')).toHaveLength(
      1,
    );
    expect(log).not.toHaveTextContent('There is no open trade session.');
  });
});
