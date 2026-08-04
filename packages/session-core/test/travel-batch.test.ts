import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { CompiledContentPack } from '@woven-deep/content';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import {
  createNewRun,
  descendToNextFloor,
  encodeActiveRun,
  heroActor,
  projectGameplayState,
  resolveCommand,
  DEFAULT_GUEST_HERO,
  type ActiveRun,
  type GameplayProjection,
  type PublicEvent,
  type Uint32State,
} from '@woven-deep/engine';
import { createAutoPickupPolicy } from '../src/auto-pickup.js';
import { buildIntent } from '../src/command-builder.js';
import { computeExplorePath } from '../src/explore.js';
import type { PlayerIntent } from '../src/intents.js';
import {
  advanceTravel,
  baseStopPredicate,
  beginTravel,
  classicStopPredicate,
  computeTravelPath,
} from '../src/travel.js';
import { runTravelBatch, TRAVEL_BATCH_CAP, type TravelBatchRequest } from '../src/travel-batch.js';

const SEED = [7, 14, 21, 28] as unknown as Uint32State;
let pack: CompiledContentPack;

beforeAll(async () => {
  pack = await compileContentDirectory({
    rootDir: resolve(import.meta.dirname, '../../../content'),
  });
});

function onStairDown(run: ActiveRun): ActiveRun {
  const floor = run.floors.find((candidate) => candidate.floorId === run.activeFloorId)!;
  const hero = heroActor(run);
  return {
    ...run,
    actors: run.actors.map((actor) =>
      actor.actorId === hero.actorId
        ? { ...actor, x: floor.stairDown!.x, y: floor.stairDown!.y }
        : actor,
    ),
  };
}

function project(run: ActiveRun): GameplayProjection {
  return projectGameplayState({ state: run, content: pack });
}

function depthOneRun(): ActiveRun {
  const run = createNewRun({ pack, seed: SEED, hero: DEFAULT_GUEST_HERO });
  return descendToNextFloor(onStairDown(run), { content: pack }).state;
}

const commandId = (index: number): string => `command.t-${index}`;

/**
 * An INDEPENDENT reference walk, wired the way `useAutoTravel` wires one (its `startClassicWalk`
 * for explore, its plain `beginTravel` for click-travel) and stepped one intent at a time. The
 * point of the parity test is not that `advanceTravel` agrees with itself -- `runTravelBatch` calls
 * it -- but that the batch's WIRING (which stop set, replan or not, auto-pickup, the terminal
 * pickup, the offered set) matches the client's. That wiring is restated here on purpose.
 */
function referenceWalk(
  run: ActiveRun,
  request: TravelBatchRequest,
  limit: number,
): { run: ActiveRun; steps: number; reason: string | null } {
  let current = run;
  let projection = project(current);
  const offered = new Set(request.offeredItemIds);
  const autoPickup =
    request.autoPickup === null
      ? null
      : createAutoPickupPolicy({ pack, allowConsumables: request.autoPickup.allowConsumables });

  const planned =
    request.mode === 'explore' ? (computeExplorePath(projection) ?? []) : request.steps;
  if (request.mode === 'explore' && planned.length === 0) {
    return { run: current, steps: 0, reason: 'arrived' };
  }

  let travel = beginTravel(
    projection,
    { steps: planned, onArrive: request.onArrive },
    {
      mode: request.mode,
      stopWhen:
        request.mode === 'explore'
          ? classicStopPredicate({
              start: projection,
              autoPickup: autoPickup ?? (() => false),
              offered,
            })
          : baseStopPredicate(projection),
      ...(autoPickup ? { autoPickup } : {}),
      ...(request.mode === 'explore' ? { replan: computeExplorePath } : {}),
    },
  );

  let lastEvents: readonly PublicEvent[] = [];
  let steps = 0;
  while (steps < limit) {
    let dispatched: PlayerIntent | null = null;
    const outcome = advanceTravel({
      projection,
      travel,
      lastEvents,
      dispatch: (intent) => {
        dispatched = intent;
      },
    });
    if (outcome.status !== 'stepping' && dispatched === null) {
      return {
        run: current,
        steps,
        reason: outcome.status === 'arrived' ? 'arrived' : outcome.reason,
      };
    }
    if (dispatched === null) return { run: current, steps, reason: null };

    const built = buildIntent({
      intent: dispatched,
      projection,
      commandId: commandId(steps),
      expectedRevision: current.revision,
      pack,
    });
    if (built.kind !== 'command') return { run: current, steps, reason: 'action-invalid' };
    const resolution = resolveCommand(current, built.command, { content: pack });
    current = resolution.state;
    lastEvents = resolution.events;
    projection = project(current);
    steps += 1;
    if (outcome.status !== 'stepping') {
      return {
        run: current,
        steps,
        reason: outcome.status === 'arrived' ? 'arrived' : outcome.reason,
      };
    }
    travel = outcome.travel;
  }
  return { run: current, steps, reason: null };
}

const exploreRequest: TravelBatchRequest = {
  mode: 'explore',
  steps: [],
  onArrive: null,
  autoPickup: { allowConsumables: true },
  offeredItemIds: [],
};

/**
 * A run positioned mid-leg, where explore walks freely for far longer than the cap.
 *
 * A freshly-entered depth-1 floor is NOT such a place: its first leg is only two steps before the
 * classic stop set fires (something new is immediately in view). Tests about the cap and about
 * resuming need a walk that would otherwise keep going, so this advances until a batch comes back
 * cap-limited (`reason === null`) and hands back the run that batch started from.
 */
function midLegRun(): { run: ActiveRun; nextCommandIndex: number } {
  let current = depthOneRun();
  let issued = 0;
  let offeredItemIds: readonly string[] = [];
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const before = current;
    const beforeIssued = issued;
    const chunk = runTravelBatch({
      run: current,
      pack,
      request: { ...exploreRequest, offeredItemIds },
      mintCommandId: (index) => commandId(issued + index),
    });
    if (chunk.reason === null && chunk.steps.length === TRAVEL_BATCH_CAP) {
      return { run: before, nextCommandIndex: beforeIssued };
    }
    if (chunk.steps.length === 0) break;
    current = chunk.steps.at(-1)!.run;
    issued += chunk.steps.length;
    offeredItemIds = chunk.offeredItemIds;
  }
  throw new Error('no uninterrupted explore leg found to test the cap against');
}

describe('runTravelBatch', () => {
  it('matches a step-at-a-time walk byte-for-byte (explore)', () => {
    const run = depthOneRun();
    const reference = referenceWalk(run, exploreRequest, TRAVEL_BATCH_CAP);
    const batched = runTravelBatch({
      run,
      pack,
      request: exploreRequest,
      mintCommandId: commandId,
    });

    expect(batched.steps).toHaveLength(reference.steps);
    expect(batched.reason).toBe(reference.reason);
    // The run itself, `recentCommands` and RNG streams included -- the invariant that makes a
    // batched walk indistinguishable from the stepped one it replaces.
    const finalRun = batched.steps.at(-1)!.run;
    expect(encodeActiveRun(finalRun)).toEqual(encodeActiveRun(reference.run));
  });

  it('matches a step-at-a-time walk byte-for-byte (click-travel)', () => {
    const run = depthOneRun();
    const projection = project(run);
    // The frontier path is itself a valid walk from the hero, so its endpoint is a guaranteed
    // reachable destination -- the exact cell does not matter, only that both walks get one plan.
    const destination = computeExplorePath(projection)!.at(-1)!;
    const path = computeTravelPath({ projection, destination })!;
    expect(path.length).toBeGreaterThan(0);

    const request: TravelBatchRequest = {
      mode: 'travel',
      steps: path,
      onArrive: null,
      autoPickup: null,
      offeredItemIds: [],
    };
    const reference = referenceWalk(run, request, TRAVEL_BATCH_CAP);
    const batched = runTravelBatch({ run, pack, request, mintCommandId: commandId });

    expect(batched.steps).toHaveLength(reference.steps);
    expect(batched.reason).toBe(reference.reason);
    expect(encodeActiveRun(batched.steps.at(-1)!.run)).toEqual(encodeActiveRun(reference.run));
  });

  it('stops at the cap with a null reason so the client asks for more', () => {
    const { run, nextCommandIndex } = midLegRun();
    const batched = runTravelBatch({
      run,
      pack,
      request: exploreRequest,
      mintCommandId: (index) => commandId(nextCommandIndex + index),
      cap: 4,
    });
    expect(batched.steps).toHaveLength(4);
    // null means "not finished, only capped" -- a StopReason here would make the client report a
    // stop that never happened and abandon the walk.
    expect(batched.reason).toBeNull();
  });

  it('resumes across batches to the same place a single long walk reaches', () => {
    const { run, nextCommandIndex } = midLegRun();
    const mint = (index: number): string => commandId(nextCommandIndex + index);
    const single = runTravelBatch({
      run,
      pack,
      request: exploreRequest,
      mintCommandId: mint,
      cap: 12,
    });
    expect(single.steps).toHaveLength(12);

    let current = run;
    let taken = 0;
    let offeredItemIds: readonly string[] = [];
    for (let batch = 0; batch < 4 && taken < 12; batch += 1) {
      const chunk = runTravelBatch({
        run: current,
        pack,
        request: { ...exploreRequest, offeredItemIds },
        // Continue the SAME id sequence across batches: restarting at 0 would collide with ids the
        // reducer still holds in `recentCommands` and every step would be refused.
        mintCommandId: (index) => mint(taken + index),
        cap: 3,
      });
      if (chunk.steps.length === 0) break;
      current = chunk.steps.at(-1)!.run;
      taken += chunk.steps.length;
      offeredItemIds = chunk.offeredItemIds;
    }

    expect(taken).toBe(12);
    // Four 3-step batches land byte-identically to one 12-step batch: the resume carries no seam.
    expect(encodeActiveRun(current)).toEqual(encodeActiveRun(single.steps.at(-1)!.run));
  });

  it('reports every step so a batch can be animated rather than snapped', () => {
    const run = depthOneRun();
    const batched = runTravelBatch({
      run,
      pack,
      request: exploreRequest,
      mintCommandId: commandId,
    });
    expect(batched.steps.length).toBeGreaterThan(1);
    // Strictly increasing revisions: one engine turn per entry, in order.
    const revisions = batched.steps.map((step) => step.run.revision);
    expect(revisions).toEqual([...revisions].sort((a, b) => a - b));
    expect(new Set(revisions).size).toBe(revisions.length);
  });

  it('carries the offered-item set forward so a declined item does not re-halt the walk', () => {
    const run = depthOneRun();
    const batched = runTravelBatch({
      run,
      pack,
      request: { ...exploreRequest, offeredItemIds: ['item.already-declined'] },
      mintCommandId: commandId,
    });
    expect(batched.offeredItemIds).toContain('item.already-declined');
  });

  it('reports a walk with nothing to do as arrived without applying anything', () => {
    const run = depthOneRun();
    const batched = runTravelBatch({
      run,
      pack,
      request: { mode: 'travel', steps: [], onArrive: null, autoPickup: null, offeredItemIds: [] },
      mintCommandId: commandId,
    });
    expect(batched.steps).toHaveLength(0);
    expect(batched.reason).toBe('arrived');
    // Nothing applied means the run is untouched -- an empty plan must not burn a turn.
    expect(encodeActiveRun(run)).toEqual(encodeActiveRun(depthOneRun()));
  });
});
