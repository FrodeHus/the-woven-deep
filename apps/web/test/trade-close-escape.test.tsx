import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import type { CompiledContentPack } from '@woven-deep/content';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import {
  createNewRun, DEFAULT_GUEST_HERO, encodeActiveRun, heroActor, heroPerception, refreshKnowledge,
  validateActiveRun, type ActiveRun, type FloorSnapshot, type MerchantPopulation,
} from '@woven-deep/engine';
import { GuestSession } from '../src/session/guest-session.js';
import { SAVE_KEY, type SessionStorageLike } from '../src/session/storage.js';
import { PlayScreen } from '../src/ui/PlayScreen.js';

let pack: CompiledContentPack;

const SEED = [3, 5, 7, 9] as const;

beforeAll(async () => {
  pack = await compileContentDirectory({ rootDir: resolve(import.meta.dirname, '../../../content') });
});

function fakeStorage(): SessionStorageLike {
  const store = new Map<string, string>();
  return {
    get: (key: string) => store.get(key) ?? null,
    set: (key: string, value: string) => { store.set(key, value); },
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
    actors: run.actors.map((actor) => actor.actorId === hero.actorId ? { ...actor, ...position } : actor),
  };
  const floor = townFloor(moved);
  const movedHero = heroActor(moved);
  const knowledge = refreshKnowledge({
    floor, hero: heroPerception(moved.hero, movedHero),
    actors: new Map(moved.actors.filter((actor) => actor.floorId === floor.floorId).map((actor) => [actor.actorId, actor] as const)),
  }).knowledge;
  return validateActiveRun({
    ...moved,
    floors: moved.floors.map((candidate) => candidate.floorId === floor.floorId ? { ...candidate, knowledge } : candidate),
  });
}

/** Stands the hero directly beside (Chebyshev distance 1 from) the given point. */
function adjacentFreeCell(run: ActiveRun, target: Readonly<{ x: number; y: number }>): Readonly<{ x: number; y: number }> {
  const floor = townFloor(run);
  const occupied = new Set(run.actors.filter((actor) => actor.floorId === floor.floorId && actor.health > 0)
    .map((actor) => `${actor.x}:${actor.y}`));
  for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]] as const) {
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
  const merchant = fresh.populations.find((population): population is MerchantPopulation => population.model === 'merchant')!;
  const actor = fresh.actors.find((candidate) => candidate.actorId === merchant.actorId)!;
  const heroCell = adjacentFreeCell(fresh, actor);
  const positioned = teleportHero(fresh, heroCell);

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

    render(<PlayScreen session={guestSession} pack={pack} />);
    expect(screen.getByRole('dialog', { name: 'Trade' })).toBeInTheDocument();

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog', { name: 'Trade' })).not.toBeInTheDocument();
    const log = screen.getByRole('log', { name: 'Adventure log' });
    expect(log).not.toHaveTextContent('There is no open trade session.');
  });
});
