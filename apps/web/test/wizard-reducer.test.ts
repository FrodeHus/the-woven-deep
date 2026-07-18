import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { CompiledContentPack } from '@woven-deep/content';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import { rerollAttributes, rollAttributes, type Uint32State } from '@woven-deep/engine';
import {
  initialWizardState, wizardChoices, wizardPreview, wizardReduce,
  type WizardAction, type WizardState,
} from '../src/session/wizard-reducer.js';

let pack: CompiledContentPack;

const SEED: Uint32State = [11, 22, 33, 44];

beforeAll(async () => {
  pack = await compileContentDirectory({ rootDir: resolve(import.meta.dirname, '../../../content') });
});

function context(seed: Uint32State = SEED): { pack: CompiledContentPack; seed: Uint32State } {
  return { pack, seed };
}

function dispatchAll(state: WizardState, actions: readonly WizardAction[], seed: Uint32State = SEED): WizardState {
  return actions.reduce((current, action) => wizardReduce(current, action, context(seed)), state);
}

// Well-known ids from content/classes, content/backgrounds, content/traits.
const WAYFARER = 'class.wayfarer';
const LAMPLIGHTER = 'class.lamplighter';
const ARCHIVIST = 'class.archivist'; // locked
const CARAVAN_GUARD = 'background.caravan-guard';
const DEEP_MINER = 'background.deep-miner';
const KEEN_EYED = 'trait.keen-eyed';
const SURE_FOOTED = 'trait.sure-footed';
const STEADY_HANDS = 'trait.steady-hands';

function wayfarerKitId(): string {
  const entry = pack.entries.find((candidate) => candidate.kind === 'class' && candidate.id === WAYFARER);
  return (entry as { kits: readonly { kitId: string }[] }).kits[0]!.kitId;
}

describe('wizardReduce', () => {
  it('blocks next at step 1 until a name is entered', () => {
    const state = initialWizardState(SEED);
    expect(state.step).toBe(1);

    const blocked = wizardReduce(state, { type: 'next' }, context());
    expect(blocked.step).toBe(1);

    const named = wizardReduce(state, { type: 'set-name', name: 'Rin' }, context());
    const advanced = wizardReduce(named, { type: 'next' }, context());
    expect(advanced.step).toBe(2);
  });

  it('blocks next at step 2 until a class is chosen', () => {
    const state = dispatchAll(initialWizardState(SEED), [{ type: 'set-name', name: 'Rin' }, { type: 'next' }]);
    expect(state.step).toBe(2);

    const blocked = wizardReduce(state, { type: 'next' }, context());
    expect(blocked.step).toBe(2);

    const chosen = wizardReduce(state, { type: 'choose-class', classId: WAYFARER }, context());
    const advanced = wizardReduce(chosen, { type: 'next' }, context());
    expect(advanced.step).toBe(3);
  });

  it('blocks next at step 3 until a kit is chosen', () => {
    const state = dispatchAll(initialWizardState(SEED), [
      { type: 'set-name', name: 'Rin' }, { type: 'next' },
      { type: 'choose-class', classId: WAYFARER }, { type: 'next' },
    ]);
    expect(state.step).toBe(3);
    expect(state.kitId).toBeNull();

    const blocked = wizardReduce(state, { type: 'next' }, context());
    expect(blocked.step).toBe(3);

    const withKit = wizardReduce(state, { type: 'choose-kit', kitId: wayfarerKitId() }, context());
    expect(withKit.kitId).not.toBeNull();
    const advanced = wizardReduce(withKit, { type: 'next' }, context());
    expect(advanced.step).toBe(4);
  });

  it('rolls attributes deterministically from the seed', () => {
    const state = dispatchAll(initialWizardState(SEED), [
      { type: 'set-name', name: 'Rin' }, { type: 'next' },
      { type: 'choose-method', method: 'roll' }, { type: 'next' },
    ]);
    const rolled = wizardReduce(state, { type: 'roll' }, context());
    const expected = rollAttributes(SEED);
    expect(rolled.attributes).toEqual(expected.attributes);
    expect(rolled.rollState).toEqual(expected);
    expect(rolled.rerollUsed).toBe(false);
  });

  it('lets reroll run once, then treats further rerolls as a no-op', () => {
    const state = dispatchAll(initialWizardState(SEED), [
      { type: 'set-name', name: 'Rin' }, { type: 'next' },
      { type: 'choose-method', method: 'roll' }, { type: 'next' },
      { type: 'roll' },
    ]);
    const firstRoll = rollAttributes(SEED);
    const expectedReroll = rerollAttributes(firstRoll);

    const rerolled = wizardReduce(state, { type: 'reroll' }, context());
    expect(rerolled.attributes).toEqual(expectedReroll.attributes);
    expect(rerolled.rerollUsed).toBe(true);

    const secondReroll = wizardReduce(rerolled, { type: 'reroll' }, context());
    expect(secondReroll).toBe(rerolled); // no-op: same reference
    expect(secondReroll.attributes).toEqual(expectedReroll.attributes);
  });

  it('ignores roll when the method is not roll (no rollState to misbehave against)', () => {
    const state = dispatchAll(initialWizardState(SEED), [
      { type: 'set-name', name: 'Rin' }, { type: 'next' },
      { type: 'choose-method', method: 'point-buy' },
    ]);
    expect(state.rollState).toBeNull();

    const rejected = wizardReduce(state, { type: 'roll' }, context());
    expect(rejected).toBe(state);
    expect(rejected.rollState).toBeNull();
  });

  it('treats reroll as a no-op when there is no active roll state yet', () => {
    const state = dispatchAll(initialWizardState(SEED), [
      { type: 'set-name', name: 'Rin' }, { type: 'next' },
      { type: 'choose-method', method: 'roll' }, { type: 'next' },
    ]);
    expect(state.rollState).toBeNull();

    const rejected = wizardReduce(state, { type: 'reroll' }, context());
    expect(rejected).toBe(state);
  });

  it('does not reset a used reroll when the method is switched away and back (one reroll means one)', () => {
    const state = dispatchAll(initialWizardState(SEED), [
      { type: 'set-name', name: 'Rin' }, { type: 'next' },
      { type: 'choose-method', method: 'roll' }, { type: 'next' },
      { type: 'roll' },
    ]);
    const rerolled = wizardReduce(state, { type: 'reroll' }, context());
    expect(rerolled.rerollUsed).toBe(true);

    const switchedAway = wizardReduce(rerolled, { type: 'choose-method', method: 'point-buy' }, context());
    const switchedBack = wizardReduce(switchedAway, { type: 'choose-method', method: 'roll' }, context());
    expect(switchedBack.rerollUsed).toBe(true);
  });

  it('rejects choosing a locked class as a no-op', () => {
    const state = dispatchAll(initialWizardState(SEED), [
      { type: 'set-name', name: 'Rin' }, { type: 'next' },
    ]);
    expect(state.step).toBe(2);

    const rejected = wizardReduce(state, { type: 'choose-class', classId: ARCHIVIST }, context());
    expect(rejected).toBe(state);
    expect(rejected.classId).toBeNull();
  });

  it('rejects choosing a kit that belongs to a different class than the one selected', () => {
    const withClass = dispatchAll(initialWizardState(SEED), [
      { type: 'set-name', name: 'Rin' }, { type: 'next' },
      { type: 'choose-method', method: 'roll' }, { type: 'next' },
      { type: 'roll' }, { type: 'next' },
      { type: 'choose-class', classId: WAYFARER },
    ]);
    const lamplighterEntry = pack.entries.find(
      (candidate) => candidate.kind === 'class' && candidate.id === LAMPLIGHTER,
    ) as { kits: readonly { kitId: string }[] };
    const foreignKitId = lamplighterEntry.kits[0]!.kitId;

    const rejected = wizardReduce(withClass, { type: 'choose-kit', kitId: foreignKitId }, context());
    expect(rejected).toBe(withClass);
    expect(rejected.kitId).toBeNull();

    const accepted = wizardReduce(withClass, { type: 'choose-kit', kitId: wayfarerKitId() }, context());
    expect(accepted.kitId).toBe(wayfarerKitId());
  });

  it('caps trait selection at two, treating a third toggle as a no-op', () => {
    const withTwoTraits = dispatchAll(initialWizardState(SEED), [
      { type: 'toggle-trait', traitId: KEEN_EYED },
      { type: 'toggle-trait', traitId: SURE_FOOTED },
    ]);
    expect(withTwoTraits.traitIds).toEqual([KEEN_EYED, SURE_FOOTED]);

    const rejected = wizardReduce(withTwoTraits, { type: 'toggle-trait', traitId: STEADY_HANDS }, context());
    expect(rejected).toBe(withTwoTraits);
    expect(rejected.traitIds).toEqual([KEEN_EYED, SURE_FOOTED]);

    // Untoggling one of the two frees a slot.
    const untoggled = wizardReduce(withTwoTraits, { type: 'toggle-trait', traitId: KEEN_EYED }, context());
    expect(untoggled.traitIds).toEqual([SURE_FOOTED]);
    const nowAccepted = wizardReduce(untoggled, { type: 'toggle-trait', traitId: STEADY_HANDS }, context());
    expect(nowAccepted.traitIds).toEqual([SURE_FOOTED, STEADY_HANDS]);
  });

  it('rejects a point-buy set-attribute that would exceed the budget or bounds', () => {
    const balance = pack.entries.find((entry) => entry.kind === 'balance') as {
      attributeMaximum: number; attributeMinimum: number; pointBuy: { budget: number };
    };
    const withPointBuy = dispatchAll(initialWizardState(SEED), [
      { type: 'set-name', name: 'Rin' }, { type: 'next' },
      { type: 'choose-method', method: 'point-buy' },
    ]);
    expect(withPointBuy.attributes).not.toBeNull();

    // Out of bounds (above attributeMaximum).
    const outOfBounds = wizardReduce(
      withPointBuy, { type: 'set-attribute', attribute: 'might', value: balance.attributeMaximum + 1 }, context(),
    );
    expect(outOfBounds).toBe(withPointBuy);

    // Push every attribute to the maximum, which must blow the budget (budget of 30 cannot
    // afford 5 attributes at max 30) — the final push should be rejected as a no-op.
    let state = withPointBuy;
    let rejectedSomewhere = false;
    for (const attributeName of ['might', 'agility', 'vitality', 'wits', 'resolve'] as const) {
      const attempt = wizardReduce(
        state, { type: 'set-attribute', attribute: attributeName, value: balance.attributeMaximum }, context(),
      );
      if (attempt === state) {
        rejectedSomewhere = true;
      } else {
        state = attempt;
      }
    }
    expect(rejectedSomewhere).toBe(true);

    // A legal, in-budget change is accepted.
    const accepted = wizardReduce(withPointBuy, { type: 'set-attribute', attribute: 'might', value: 5 }, context());
    expect(accepted.attributes!.might).toBe(5);
  });

  it('preserves entered data when going back', () => {
    const state = dispatchAll(initialWizardState(SEED), [
      { type: 'set-name', name: 'Rin' }, { type: 'next' },
      { type: 'choose-class', classId: WAYFARER }, { type: 'next' },
      { type: 'choose-kit', kitId: wayfarerKitId() }, { type: 'next' },
      { type: 'choose-method', method: 'roll' }, { type: 'roll' },
    ]);
    expect(state.step).toBe(4);

    const back = wizardReduce(state, { type: 'back' }, context());
    expect(back.step).toBe(3);
    expect(back.name).toBe('Rin');
    expect(back.method).toBe('roll');
    expect(back.attributes).toEqual(state.attributes);

    const beforeStart = dispatchAll(initialWizardState(SEED), []);
    const stillAtOne = wizardReduce(beforeStart, { type: 'back' }, context());
    expect(stillAtOne).toBe(beforeStart);
  });

  it('produces null wizardChoices until step 7 is reached with every selection made, then matches the selections', () => {
    const state = dispatchAll(initialWizardState(SEED), [
      { type: 'set-name', name: 'Rin' }, { type: 'next' },
      { type: 'choose-class', classId: WAYFARER }, { type: 'next' },
      { type: 'choose-kit', kitId: wayfarerKitId() }, { type: 'next' },
      { type: 'choose-method', method: 'roll' }, { type: 'roll' }, { type: 'next' },
      { type: 'choose-background', backgroundId: CARAVAN_GUARD }, { type: 'next' },
      { type: 'toggle-trait', traitId: KEEN_EYED },
    ]);
    expect(state.step).toBe(6);
    expect(wizardChoices(state)).toBeNull();

    const atSummary = wizardReduce(state, { type: 'next' }, context());
    expect(atSummary.step).toBe(7);

    const choices = wizardChoices(atSummary);
    expect(choices).not.toBeNull();
    expect(choices).toEqual({
      name: 'Rin',
      method: 'roll',
      attributes: state.attributes,
      classId: WAYFARER,
      kitId: wayfarerKitId(),
      backgroundId: CARAVAN_GUARD,
      traitIds: [KEEN_EYED],
    });
  });

  it('reflects background and trait modifiers in the live preview', () => {
    const withAttributesOnly = dispatchAll(initialWizardState(SEED), [
      { type: 'set-name', name: 'Rin' }, { type: 'next' },
      { type: 'choose-method', method: 'roll' }, { type: 'next' },
      { type: 'roll' },
    ]);
    const baselinePreview = wizardPreview(withAttributesOnly, pack);
    expect(baselinePreview).not.toBeNull();

    const withBackgroundAndTraits = dispatchAll(withAttributesOnly, [
      { type: 'choose-background', backgroundId: DEEP_MINER }, // modifiers: { search: 1 }
      { type: 'toggle-trait', traitId: KEEN_EYED }, // modifiers: { search: 2 }
      { type: 'toggle-trait', traitId: SURE_FOOTED }, // modifiers: { defense: 1 }
    ]);
    const boostedPreview = wizardPreview(withBackgroundAndTraits, pack);
    expect(boostedPreview).not.toBeNull();
    expect(boostedPreview!.search).toBe(baselinePreview!.search + 3);
    expect(boostedPreview!.defense).toBe(baselinePreview!.defense + 1);
    // Unrelated stats stay put.
    expect(boostedPreview!.meleeAccuracy).toBe(baselinePreview!.meleeAccuracy);
  });

  it('returns null preview before attributes exist', () => {
    const state = initialWizardState(SEED);
    expect(wizardPreview(state, pack)).toBeNull();
  });

  it('advances Identity(1) -> Calling(2) -> Kit(3) -> Attributes(4) -> Origin(5) -> Traits(6) -> Review(7)', () => {
    let s = initialWizardState(SEED);
    expect(wizardReduce(s, { type: 'next' }, context())).toBe(s); // blocked: no name

    s = wizardReduce(s, { type: 'set-name', name: 'Ash' }, context());
    s = wizardReduce(s, { type: 'next' }, context());
    expect(s.step).toBe(2);

    expect(wizardReduce(s, { type: 'next' }, context())).toBe(s); // blocked: no class
    s = wizardReduce(s, { type: 'choose-class', classId: WAYFARER }, context());
    s = wizardReduce(s, { type: 'next' }, context());
    expect(s.step).toBe(3);

    expect(wizardReduce(s, { type: 'next' }, context())).toBe(s); // blocked: no kit
    s = wizardReduce(s, { type: 'choose-kit', kitId: wayfarerKitId() }, context());
    s = wizardReduce(s, { type: 'next' }, context());
    expect(s.step).toBe(4);

    expect(wizardReduce(s, { type: 'next' }, context())).toBe(s); // blocked: no attributes
    s = wizardReduce(s, { type: 'choose-method', method: 'roll' }, context());
    s = wizardReduce(s, { type: 'roll' }, context());
    s = wizardReduce(s, { type: 'next' }, context());
    expect(s.step).toBe(5);

    expect(wizardReduce(s, { type: 'next' }, context())).toBe(s); // blocked: no background
    s = wizardReduce(s, { type: 'choose-background', backgroundId: CARAVAN_GUARD }, context());
    s = wizardReduce(s, { type: 'next' }, context());
    expect(s.step).toBe(6);

    // traits optional -- step 6 advances with zero traits selected
    s = wizardReduce(s, { type: 'next' }, context());
    expect(s.step).toBe(7);

    expect(wizardChoices(s)).toMatchObject({
      name: 'Ash', classId: WAYFARER, kitId: wayfarerKitId(), backgroundId: CARAVAN_GUARD,
    });
  });

  it('choosing a class on step 2 resets a previously chosen kit', () => {
    const atKitStep = dispatchAll(initialWizardState(SEED), [
      { type: 'set-name', name: 'Ash' }, { type: 'next' },
      { type: 'choose-class', classId: WAYFARER }, { type: 'next' },
      { type: 'choose-kit', kitId: wayfarerKitId() },
    ]);
    expect(atKitStep.kitId).toBe(wayfarerKitId());

    const backToClass = wizardReduce(atKitStep, { type: 'back' }, context());
    expect(backToClass.step).toBe(2);
    expect(backToClass.kitId).toBe(wayfarerKitId());

    const chosenAnother = wizardReduce(
      backToClass, { type: 'choose-class', classId: LAMPLIGHTER }, context(),
    );
    expect(chosenAnother.classId).toBe(LAMPLIGHTER);
    expect(chosenAnother.kitId).toBeNull();
  });

  it('point-buy path also satisfies step 4', () => {
    const atAttributesStep = dispatchAll(initialWizardState(SEED), [
      { type: 'set-name', name: 'Ash' }, { type: 'next' },
      { type: 'choose-class', classId: WAYFARER }, { type: 'next' },
      { type: 'choose-kit', kitId: wayfarerKitId() }, { type: 'next' },
    ]);
    expect(atAttributesStep.step).toBe(4);
    expect(wizardReduce(atAttributesStep, { type: 'next' }, context())).toBe(atAttributesStep);

    const withPointBuy = wizardReduce(
      atAttributesStep, { type: 'choose-method', method: 'point-buy' }, context(),
    );
    expect(withPointBuy.attributes).not.toBeNull();

    const advanced = wizardReduce(withPointBuy, { type: 'next' }, context());
    expect(advanced.step).toBe(5);
  });
});
