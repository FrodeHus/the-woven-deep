import { beforeAll, describe, expect, it } from 'vitest';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import { resolve } from 'node:path';
import type { CompiledContentPack } from '@woven-deep/content';
import {
  ascendToPreviousFloor,
  createFloorItem,
  createGameplayDemoRun,
  createNewRun,
  createRecordedHeirloom,
  DEFAULT_GUEST_HERO,
  descendToNextFloor,
  heroActor,
  resolveCommand,
  validateActiveRun,
  type ActiveRun,
  type DomainEvent,
  type ItemInstance,
} from '../src/index.js';

let pack: CompiledContentPack;

beforeAll(async () => {
  pack = await compileContentDirectory({
    rootDir: resolve(import.meta.dirname, '../../../content'),
  });
});

/** Warden's Ember: `signature: { spellId: spell.ember-bolt, charges: 3, rechargePerFloor: 1 }` --
 * the same spell `item.ember-scroll` reads, which is what makes the two directly comparable. */
const EMBER_ARTIFACT = 'item.warden-ember';
const EMBER_ARTIFACT_ITEM_ID = 'item.warden-ember.1';
const EMBER_SCROLL_ITEM_ID = 'item.ember-scroll.1';

/** The Drowned Crown: `signature: { spellId: spell.frost-nova, charges: 2, rechargePerFloor: 1 }`
 * -- an AoE (`target.burst`, radius 2) signature, paired with the frost-nova scroll that reads the
 * same spell, so the sweep path is compared the same way the single-target one is. */
const NOVA_ARTIFACT = 'item.tide-crown';
const NOVA_ARTIFACT_ITEM_ID = 'item.tide-crown.1';
const NOVA_SCROLL_ITEM_ID = 'item.frost-nova-scroll.1';

function instance(
  contentId: string,
  itemId: string,
  actorId: string,
  charges: number | null,
  location: ItemInstance['location'] = { type: 'backpack', actorId },
): ItemInstance {
  return {
    itemId,
    contentId,
    quantity: 1,
    condition: 100,
    enchantment: null,
    identified: true,
    charges,
    fuel: null,
    enabled: null,
    location,
  };
}

/**
 * The gameplay demo hero with the cave rat relocated one cell east -- in range and lit -- carrying
 * whatever item instances the caller supplies. The hero keeps no classTags (a non-caster), which
 * proves a signature cast needs no aptitude, exactly like a scroll read.
 */
function runCarrying(build: (actorId: string) => readonly ItemInstance[]): {
  run: ActiveRun;
  target: Readonly<{ x: number; y: number }>;
} {
  const { run } = createGameplayDemoRun(pack);
  const hero = run.actors.find((actor) => actor.playerControlled)!;
  const target = { x: hero.x + 1, y: hero.y };
  const actors = run.actors.map((actor) =>
    actor.contentId === 'monster.cave-rat' ? { ...actor, ...target } : actor,
  );
  return {
    run: {
      ...run,
      actors,
      items: [...run.items, ...build(hero.actorId)],
      hero: { ...run.hero, classTags: [] },
    },
    target,
  };
}

/** Event streams with the source item id blanked out, so an artifact's stream and the equivalent
 * scroll's stream differ only where the mechanics genuinely differ (the scroll's consumption). */
function comparableEvents(events: readonly DomainEvent[]): readonly unknown[] {
  return events.map((event) =>
    'itemId' in event ? { ...event, itemId: '<source>' } : { ...event },
  );
}

describe('artifact signature cast', () => {
  it('resolves the signature spell, spends a charge, and keeps the artifact and the Weave', () => {
    const { run, target } = runCarrying((actorId) => [
      instance(EMBER_ARTIFACT, EMBER_ARTIFACT_ITEM_ID, actorId, 3),
    ]);
    const hero = run.actors.find((actor) => actor.playerControlled)!;
    const rat = run.actors.find((actor) => actor.contentId === 'monster.cave-rat')!;

    const result = resolveCommand(
      run,
      {
        type: 'use-item',
        commandId: 'command.signature',
        expectedRevision: run.revision,
        itemId: EMBER_ARTIFACT_ITEM_ID,
        target,
      },
      { content: pack },
    );

    expect(result.result.status).toBe('applied');
    const heroAfter = result.state.actors.find((actor) => actor.playerControlled)!;
    expect(heroAfter.weave).toBe(hero.weave); // charges are the cost; the Weave is never charged
    const ratAfter = result.state.actors.find((actor) => actor.actorId === rat.actorId)!;
    expect(ratAfter.health).toBeLessThan(rat.health);
    const artifactAfter = result.state.items.find((item) => item.itemId === EMBER_ARTIFACT_ITEM_ID);
    expect(artifactAfter).toBeDefined();
    expect(artifactAfter?.charges).toBe(2);
  });

  it('casts from the equipped slot as well as the backpack', () => {
    const { run, target } = runCarrying((actorId) => [
      instance(EMBER_ARTIFACT, EMBER_ARTIFACT_ITEM_ID, actorId, 3, {
        type: 'equipped',
        actorId,
        slot: 'left-ring',
      }),
    ]);
    const hero = run.actors.find((actor) => actor.playerControlled)!;
    const equipped: ActiveRun = {
      ...run,
      actors: run.actors.map((actor) =>
        actor.actorId === hero.actorId
          ? { ...actor, equipment: { ...actor.equipment, 'left-ring': EMBER_ARTIFACT_ITEM_ID } }
          : actor,
      ),
    };

    const result = resolveCommand(
      equipped,
      {
        type: 'use-item',
        commandId: 'command.signature-equipped',
        expectedRevision: equipped.revision,
        itemId: EMBER_ARTIFACT_ITEM_ID,
        target,
      },
      { content: pack },
    );

    expect(result.result.status).toBe('applied');
    expect(result.state.items.find((item) => item.itemId === EMBER_ARTIFACT_ITEM_ID)?.charges).toBe(
      2,
    );
  });

  it('resolves the same event stream as the equivalent scroll read, minus the consumption', () => {
    const { run: artifactRun, target } = runCarrying((actorId) => [
      instance(EMBER_ARTIFACT, EMBER_ARTIFACT_ITEM_ID, actorId, 3),
    ]);
    const { run: scrollRun } = runCarrying((actorId) => [
      instance('item.ember-scroll', EMBER_SCROLL_ITEM_ID, actorId, null),
    ]);

    const command = {
      commandId: 'command.compare',
      expectedRevision: artifactRun.revision,
      target,
    } as const;
    const cast = resolveCommand(
      artifactRun,
      { type: 'use-item', ...command, itemId: EMBER_ARTIFACT_ITEM_ID },
      { content: pack },
    );
    const read = resolveCommand(
      scrollRun,
      { type: 'use-item', ...command, itemId: EMBER_SCROLL_ITEM_ID },
      { content: pack },
    );

    expect(cast.result.status).toBe('applied');
    expect(read.result.status).toBe('applied');
    // The scroll destroys itself; the artifact spends a charge. Everything else -- the spell's own
    // effect events, in order -- is identical, and so is the randomness the cast draws.
    expect(comparableEvents(cast.events)).toEqual(
      comparableEvents(read.events.filter((event) => event.type !== 'item.consumed')),
    );
    expect(cast.state.rng).toEqual(read.state.rng);
  });

  it('sweeps an AoE signature over the burst and matches the equivalent scroll, minus consumption', () => {
    const { run: artifactRun, target } = runCarrying((actorId) => [
      instance(NOVA_ARTIFACT, NOVA_ARTIFACT_ITEM_ID, actorId, 2),
    ]);
    const { run: scrollRun } = runCarrying((actorId) => [
      instance('item.frost-nova-scroll', NOVA_SCROLL_ITEM_ID, actorId, null),
    ]);
    const rat = artifactRun.actors.find((actor) => actor.contentId === 'monster.cave-rat')!;

    const command = {
      commandId: 'command.nova',
      expectedRevision: artifactRun.revision,
      target,
    } as const;
    const cast = resolveCommand(
      artifactRun,
      { type: 'use-item', ...command, itemId: NOVA_ARTIFACT_ITEM_ID },
      { content: pack },
    );
    const read = resolveCommand(
      scrollRun,
      { type: 'use-item', ...command, itemId: NOVA_SCROLL_ITEM_ID },
      { content: pack },
    );

    expect(cast.result.status).toBe('applied');
    expect(read.result.status).toBe('applied');
    expect(cast.state.items.find((item) => item.itemId === NOVA_ARTIFACT_ITEM_ID)?.charges).toBe(1);
    const ratAfter = cast.state.actors.find((actor) => actor.actorId === rat.actorId)!;
    expect(ratAfter.health).toBeLessThan(rat.health);
    // The sweep path, not the single-target one: an AoE signature demands an aim cell, and is
    // rejected without one exactly as an AoE scroll is -- consuming no charge and no randomness.
    const unaimed = resolveCommand(
      artifactRun,
      {
        type: 'use-item',
        commandId: 'command.nova-unaimed',
        expectedRevision: artifactRun.revision,
        itemId: NOVA_ARTIFACT_ITEM_ID,
        target: null,
      },
      { content: pack },
    );
    expect(unaimed.result).toMatchObject({ status: 'invalid', reason: 'target.invalid' });
    expect(unaimed.state.items.find((item) => item.itemId === NOVA_ARTIFACT_ITEM_ID)?.charges).toBe(
      2,
    );
    expect(unaimed.state.rng).toEqual(artifactRun.rng);
    expect(comparableEvents(cast.events)).toEqual(
      comparableEvents(read.events.filter((event) => event.type !== 'item.consumed')),
    );
    expect(cast.state.rng).toEqual(read.state.rng);
  });

  it('still consumes a scroll rather than charging it', () => {
    const { run, target } = runCarrying((actorId) => [
      instance('item.ember-scroll', EMBER_SCROLL_ITEM_ID, actorId, null),
    ]);
    const result = resolveCommand(
      run,
      {
        type: 'use-item',
        commandId: 'command.read',
        expectedRevision: run.revision,
        itemId: EMBER_SCROLL_ITEM_ID,
        target,
      },
      { content: pack },
    );
    expect(result.result.status).toBe('applied');
    expect(result.state.items.find((item) => item.itemId === EMBER_SCROLL_ITEM_ID)).toBeUndefined();
    expect(result.events.some((event) => event.type === 'item.consumed')).toBe(true);
  });

  it('rejects a spent artifact with signature.no-charges and touches neither state nor RNG', () => {
    const { run, target } = runCarrying((actorId) => [
      instance(EMBER_ARTIFACT, EMBER_ARTIFACT_ITEM_ID, actorId, 0),
    ]);

    const result = resolveCommand(
      run,
      {
        type: 'use-item',
        commandId: 'command.spent',
        expectedRevision: run.revision,
        itemId: EMBER_ARTIFACT_ITEM_ID,
        target,
      },
      { content: pack },
    );

    expect(result.result).toMatchObject({ status: 'invalid', reason: 'signature.no-charges' });
    expect(result.state.revision).toBe(run.revision);
    expect(result.state.rng).toEqual(run.rng);
    expect(result.state.items.find((item) => item.itemId === EMBER_ARTIFACT_ITEM_ID)?.charges).toBe(
      0,
    );
  });

  it('refuses to cast an artifact that has no signature at all', () => {
    const { run, target } = runCarrying((actorId) => [
      {
        ...instance('item.marias-grace', 'item.marias-grace.1', actorId, null),
        fuel: 2400,
        enabled: false,
      },
    ]);

    const result = resolveCommand(
      run,
      {
        type: 'use-item',
        commandId: 'command.grace',
        expectedRevision: run.revision,
        itemId: 'item.marias-grace.1',
        target,
      },
      { content: pack },
    );

    expect(result.result).toMatchObject({ status: 'invalid', reason: 'item.unavailable' });
  });
});

describe('artifact signature charges', () => {
  it('seeds a created artifact instance with its full signature charges', () => {
    const artifact = createFloorItem({
      content: pack,
      contentId: EMBER_ARTIFACT,
      itemId: EMBER_ARTIFACT_ITEM_ID,
      floorId: 'floor.depth-005',
      x: 3,
      y: 4,
    });
    expect(artifact.charges).toBe(3);

    const ordinary = createFloorItem({
      content: pack,
      contentId: 'item.ember-scroll',
      itemId: EMBER_SCROLL_ITEM_ID,
      floorId: 'floor.depth-005',
      x: 3,
      y: 4,
    });
    expect(ordinary.charges).toBeNull();

    // Maria's Grace has no signature: charges stay null rather than becoming a phantom 0.
    const signatureless = createFloorItem({
      content: pack,
      contentId: 'item.marias-grace',
      itemId: 'item.marias-grace.1',
      floorId: 'floor.depth-005',
      x: 3,
      y: 4,
    });
    expect(signatureless.charges).toBeNull();
  });

  it('materializes a recovered artifact with the charges its bearer left it holding', () => {
    const recovered = createRecordedHeirloom({
      content: pack,
      snapshot: {
        contentId: EMBER_ARTIFACT,
        sourceItemId: 'item.warden-ember.origin',
        enchantment: null,
        condition: 88,
        charges: 1,
        fuel: null,
        qualityRank: 0,
        displayName: "Warden's Ember",
        glyph: '*',
        color: '#ff8c42',
        originatingHallRecordId: 'record.1',
      },
      equippedItemContentIds: [EMBER_ARTIFACT],
      fallbackItemId: 'item.champion-fallback-relic',
      itemId: EMBER_ARTIFACT_ITEM_ID,
      floorId: 'floor.depth-005',
      x: 3,
      y: 4,
    });
    expect(recovered.fallback).toBe(false);
    expect(recovered.item.charges).toBe(1);
  });
});

describe('artifact signature recharge', () => {
  const SEED = [11, 22, 33, 44] as const;

  function runOnStairsCarrying(charges: number): ActiveRun {
    const run = createNewRun({ pack, seed: SEED, hero: DEFAULT_GUEST_HERO });
    const hero = heroActor(run);
    const stairDown = run.floors[0]!.stairDown!;
    return validateActiveRun({
      ...run,
      actors: run.actors.map((actor) =>
        actor.actorId === hero.actorId ? { ...actor, x: stairDown.x, y: stairDown.y } : actor,
      ),
      items: [
        ...run.items,
        instance(EMBER_ARTIFACT, EMBER_ARTIFACT_ITEM_ID, hero.actorId, charges),
      ],
    });
  }

  function chargesOf(run: ActiveRun): number | null | undefined {
    return run.items.find((item) => item.itemId === EMBER_ARTIFACT_ITEM_ID)?.charges;
  }

  it('recovers rechargePerFloor on descending into a new floor, capped at the maximum', () => {
    const descended = descendToNextFloor(runOnStairsCarrying(1), { content: pack });
    expect(chargesOf(descended.state)).toBe(2);

    const full = descendToNextFloor(runOnStairsCarrying(3), { content: pack });
    expect(chargesOf(full.state)).toBe(3);
  });

  it('does not recharge on re-entering a floor the run has already visited', () => {
    const descended = descendToNextFloor(runOnStairsCarrying(0), { content: pack });
    expect(chargesOf(descended.state)).toBe(1);

    const ascended = ascendToPreviousFloor(descended.state, { content: pack });
    const townStairDown = ascended.state.floors[0]!.stairDown!;
    const hero = heroActor(ascended.state);
    const onStairs = validateActiveRun({
      ...ascended.state,
      actors: ascended.state.actors.map((actor) =>
        actor.actorId === hero.actorId
          ? { ...actor, x: townStairDown.x, y: townStairDown.y }
          : actor,
      ),
    });
    const redescended = descendToNextFloor(onStairs, { content: pack });
    expect(chargesOf(redescended.state)).toBe(1);
  });
});
