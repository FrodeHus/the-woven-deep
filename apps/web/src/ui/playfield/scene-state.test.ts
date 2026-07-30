import { describe, expect, it } from 'vitest';
import type { GameplayProjection, PublicEvent } from '@woven-deep/engine';
import type { SessionSnapshot } from '../../session/guest-session.js';
import {
  motionPosition,
  nextSceneState,
  STEP_MS,
  type ActorSprite,
  type SceneState,
} from './scene-state.js';

function projection(
  input: Readonly<{
    floorId?: string;
    heroX: number;
    heroY: number;
    actors?: readonly Record<string, unknown>[];
    groundItems?: readonly Record<string, unknown>[];
    completionType?: 'died' | 'became-heart' | 'refused' | 'broke-cycle';
  }>,
): GameplayProjection {
  return {
    floor: { floorId: input.floorId ?? 'floor.one', width: 10, height: 10, cells: [] },
    hero: {
      actorId: 'actor.hero',
      name: 'Ada',
      x: input.heroX,
      y: input.heroY,
      health: 10,
      maxHealth: 10,
      equipment: {},
      conditions: [],
    },
    actors: input.actors ?? [],
    features: [],
    groundItems: input.groundItems ?? [],
    actions: [],
    metrics: {} as GameplayProjection['metrics'],
    conclusion:
      input.completionType === undefined
        ? null
        : {
            completionType: input.completionType,
            cause: { killerContentId: null, depth: 1, turn: 1, worldTime: 1 },
          },
    slots: [],
    house: { capacity: 0, upgradesPurchased: 0, items: [] },
  } as unknown as GameplayProjection;
}

function snapshot(
  input: Readonly<{
    floorId?: string;
    heroX: number;
    heroY: number;
    actors?: readonly Record<string, unknown>[];
    groundItems?: readonly Record<string, unknown>[];
    completionType?: 'died' | 'became-heart' | 'refused' | 'broke-cycle';
    lastEvents?: readonly PublicEvent[];
  }>,
): SessionSnapshot {
  return {
    projection: projection(input),
    log: [],
    lastEvents: input.lastEvents ?? [],
    pendingDecision: null,
    pendingFinalChamberChoice: null,
    notice: null,
    houseOpen: false,
    conclusion: null,
    sightings: { monsterIds: [], itemIds: [], landmarks: [] },
    heroClassTags: [],
    onboarding: { counts: {}, dismissed: [] },
  } as unknown as SessionSnapshot;
}

describe('nextSceneState', () => {
  it('appears in place with no motion when prev is null', () => {
    const state = nextSceneState(null, snapshot({ heroX: 5, heroY: 5 }), 1000);
    expect(state.floorId).toBe('floor.one');
    const hero = state.actors.find((actor) => actor.id === 'actor.hero')!;
    expect(hero.motion).toBeNull();
    expect(hero.x).toBe(5);
    expect(hero.y).toBe(5);
  });

  it('produces motion with correct from/to when an actor moves to a new cell', () => {
    const prevSnapshot = snapshot({
      heroX: 5,
      heroY: 5,
      actors: [
        {
          actorId: 'actor.rat',
          x: 8,
          y: 5,
          health: 6,
          maxHealth: 10,
        },
      ],
    });
    const prev = nextSceneState(null, prevSnapshot, 1000);

    const movedSnapshot = snapshot({
      heroX: 5,
      heroY: 5,
      actors: [
        {
          actorId: 'actor.rat',
          x: 9,
          y: 5,
          health: 6,
          maxHealth: 10,
        },
      ],
    });
    const next = nextSceneState(prev, movedSnapshot, 1200);
    const rat = next.actors.find((actor) => actor.id === 'actor.rat')!;
    expect(rat.motion).not.toBeNull();
    expect(rat.motion!.fromX).toBe(8);
    expect(rat.motion!.fromY).toBe(5);
    expect(rat.motion!.toX).toBe(9);
    expect(rat.motion!.toY).toBe(5);
    expect(rat.motion!.startedAt).toBe(1200);
    expect(rat.motion!.durationMs).toBe(STEP_MS);
  });

  it('starts a mid-tween re-move from the interpolated position, not the original from', () => {
    const startSnapshot = snapshot({
      heroX: 5,
      heroY: 5,
      actors: [{ actorId: 'actor.rat', x: 0, y: 0, health: 6, maxHealth: 10 }],
    });
    const startState = nextSceneState(null, startSnapshot, 0);

    const firstMoveSnapshot = snapshot({
      heroX: 5,
      heroY: 5,
      actors: [{ actorId: 'actor.rat', x: 10, y: 0, health: 6, maxHealth: 10 }],
    });
    const afterFirstMove = nextSceneState(startState, firstMoveSnapshot, 0);

    // Half-way through the STEP_MS tween.
    const midway = STEP_MS / 2;
    const secondMoveSnapshot = snapshot({
      heroX: 5,
      heroY: 5,
      actors: [{ actorId: 'actor.rat', x: 20, y: 0, health: 6, maxHealth: 10 }],
    });
    const afterSecondMove = nextSceneState(afterFirstMove, secondMoveSnapshot, midway);
    const rat = afterSecondMove.actors.find((actor) => actor.id === 'actor.rat')!;
    expect(rat.motion).not.toBeNull();
    expect(rat.motion!.fromX).toBeGreaterThan(0);
    expect(rat.motion!.fromX).toBeLessThan(10);
    expect(rat.motion!.toX).toBe(20);
  });

  it('drops motion (appears in place) when the floor changes', () => {
    const startSnapshot = snapshot({
      floorId: 'floor.one',
      heroX: 5,
      heroY: 5,
      actors: [{ actorId: 'actor.rat', x: 0, y: 0, health: 6, maxHealth: 10 }],
    });
    const startState = nextSceneState(null, startSnapshot, 0);

    const nextFloorSnapshot = snapshot({
      floorId: 'floor.two',
      heroX: 2,
      heroY: 2,
      actors: [{ actorId: 'actor.rat', x: 3, y: 3, health: 6, maxHealth: 10 }],
    });
    const next = nextSceneState(startState, nextFloorSnapshot, 1000);
    expect(next.floorId).toBe('floor.two');
    const rat = next.actors.find((actor) => actor.id === 'actor.rat')!;
    expect(rat.motion).toBeNull();
    expect(rat.x).toBe(3);
    expect(rat.y).toBe(3);
  });

  it('a brand-new actor id appears in place with no motion', () => {
    const startSnapshot = snapshot({ heroX: 5, heroY: 5, actors: [] });
    const startState = nextSceneState(null, startSnapshot, 0);

    const withNewActor = snapshot({
      heroX: 5,
      heroY: 5,
      actors: [{ actorId: 'actor.rat', x: 4, y: 4, health: 6, maxHealth: 10 }],
    });
    const next = nextSceneState(startState, withNewActor, 1000);
    const rat = next.actors.find((actor) => actor.id === 'actor.rat')!;
    expect(rat.motion).toBeNull();
    expect(rat.x).toBe(4);
    expect(rat.y).toBe(4);
  });

  it('sets hurtAt to now when lastEvents contains a hero.damaged event', () => {
    const snap = snapshot({
      heroX: 5,
      heroY: 5,
      lastEvents: [{ type: 'hero.damaged', amount: 4, damageType: 'physical' } as PublicEvent],
    });
    const state = nextSceneState(null, snap, 5000);
    expect(state.hurtAt).toBe(5000);
  });

  it('leaves hurtAt null when lastEvents has no hero-damage event', () => {
    const snap = snapshot({ heroX: 5, heroY: 5, lastEvents: [] });
    const state = nextSceneState(null, snap, 5000);
    expect(state.hurtAt).toBeNull();
  });

  it('sets concludedByDeath true when the conclusion completionType is died', () => {
    const snap = snapshot({ heroX: 5, heroY: 5, completionType: 'died' });
    const state = nextSceneState(null, snap, 0);
    expect(state.concludedByDeath).toBe(true);
  });

  it('leaves concludedByDeath false for a non-death conclusion', () => {
    const snap = snapshot({ heroX: 5, heroY: 5, completionType: 'became-heart' });
    const state = nextSceneState(null, snap, 0);
    expect(state.concludedByDeath).toBe(false);
  });

  it('leaves concludedByDeath false when the run has not concluded', () => {
    const snap = snapshot({ heroX: 5, heroY: 5 });
    const state = nextSceneState(null, snap, 0);
    expect(state.concludedByDeath).toBe(false);
  });

  it('bursts at the hero cell on the snapshot the death conclusion first appears', () => {
    const snap = snapshot({ heroX: 5, heroY: 6, completionType: 'died' });
    const state = nextSceneState(null, snap, 0);
    expect(state.effects).toContainEqual(
      expect.objectContaining({ kind: 'death-burst', x: 5, y: 6 }),
    );
  });

  it('does not repeat the hero death burst on later concluded snapshots', () => {
    const snap = snapshot({ heroX: 5, heroY: 6, completionType: 'died' });
    const first = nextSceneState(null, snap, 0);
    const second = nextSceneState(first, snap, STEP_MS);
    expect(second.effects.some((effect) => effect.kind === 'death-burst')).toBe(false);
  });

  it('does not burst for a non-death conclusion', () => {
    const snap = snapshot({ heroX: 5, heroY: 6, completionType: 'broke-cycle' });
    const state = nextSceneState(null, snap, 0);
    expect(state.effects.some((effect) => effect.kind === 'death-burst')).toBe(false);
  });
});

describe('nextSceneState facing', () => {
  const at = (x: number): Record<string, unknown> => ({
    actorId: 'actor.rat',
    contentId: 'monster.cave-rat',
    x,
    y: 0,
    health: 6,
    maxHealth: 10,
  });

  it('faces right after an eastward step and preserves it while idle', () => {
    const start = nextSceneState(null, snapshot({ heroX: 5, heroY: 5, actors: [at(0)] }), 0);
    // Step east (screen +x): x - y increases.
    const moved = nextSceneState(start, snapshot({ heroX: 5, heroY: 5, actors: [at(1)] }), 1000);
    const east = moved.actors.find((a) => a.id === 'actor.rat')!;
    expect(east.facing).toBe('right');

    // Now hold position: facing must NOT snap back to the drawn (left) orientation.
    const idle = nextSceneState(moved, snapshot({ heroX: 5, heroY: 5, actors: [at(1)] }), 2000);
    expect(idle.actors.find((a) => a.id === 'actor.rat')!.facing).toBe('right');
  });

  it('faces left after a westward step', () => {
    const start = nextSceneState(null, snapshot({ heroX: 5, heroY: 5, actors: [at(5)] }), 0);
    const moved = nextSceneState(start, snapshot({ heroX: 5, heroY: 5, actors: [at(4)] }), 1000);
    expect(moved.actors.find((a) => a.id === 'actor.rat')!.facing).toBe('left');
  });

  it('defaults a brand-new actor to the drawn (left) facing', () => {
    const state = nextSceneState(null, snapshot({ heroX: 5, heroY: 5, actors: [at(3)] }), 0);
    expect(state.actors.find((a) => a.id === 'actor.rat')!.facing).toBe('left');
  });
});

describe('motionPosition', () => {
  const sprite: ActorSprite = {
    id: 'actor.rat',
    contentId: 'monster.cave-rat',
    glyph: 'r',
    color: undefined,
    isHero: false,
    motion: { fromX: 0, fromY: 0, toX: 10, toY: 0, startedAt: 1000, durationMs: STEP_MS },
    facing: 'left',
    x: 10,
    y: 0,
    health: 6,
    maxHealth: 10,
  };

  it('returns the from position at t=0', () => {
    const [x, y] = motionPosition(sprite, 1000);
    expect(x).toBe(0);
    expect(y).toBe(0);
  });

  it('returns the to position at t>=1 (clamped)', () => {
    const [x, y] = motionPosition(sprite, 1000 + STEP_MS + 1000);
    expect(x).toBe(10);
    expect(y).toBe(0);
  });

  it('returns the current position unchanged when there is no motion', () => {
    const stillSprite: ActorSprite = { ...sprite, motion: null };
    const [x, y] = motionPosition(stillSprite, 5000);
    expect(x).toBe(10);
    expect(y).toBe(0);
  });

  it('interpolates monotonically partway through the tween', () => {
    const [xEarly] = motionPosition(sprite, 1000 + STEP_MS * 0.25);
    const [xLate] = motionPosition(sprite, 1000 + STEP_MS * 0.75);
    expect(xEarly).toBeGreaterThan(0);
    expect(xEarly).toBeLessThan(xLate);
    expect(xLate).toBeLessThan(10);
  });
});

describe('scene state shape', () => {
  it('projects ground items with id/glyph/color/x/y', () => {
    const snap = snapshot({
      heroX: 5,
      heroY: 5,
      groundItems: [{ itemId: 'item.torch', glyph: 't', color: '#fff', x: 3, y: 3 }],
    });
    const state: SceneState = nextSceneState(null, snap, 0);
    expect(state.groundItems).toEqual([
      { id: 'item.torch', glyph: 't', color: '#fff', x: 3, y: 3 },
    ]);
  });

  it('includes the hero as a sprite with isHero true', () => {
    const snap = snapshot({ heroX: 5, heroY: 5 });
    const state = nextSceneState(null, snap, 0);
    const hero = state.actors.find((actor) => actor.id === 'actor.hero')!;
    expect(hero.isHero).toBe(true);
  });

  it("gives the hero sprite the literal glyph '@', never an NPC/content glyph", () => {
    const snap = snapshot({ heroX: 5, heroY: 5 });
    const state = nextSceneState(null, snap, 0);
    const hero = state.actors.find((actor) => actor.id === 'actor.hero')!;
    expect(hero.glyph).toBe('@');
    expect(hero.isHero).toBe(true);
  });
});
