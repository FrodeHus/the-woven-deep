import type {
  BackgroundContentEntry, BalanceContentEntry, ClassContentEntry, CompiledContentPack, TraitContentEntry,
} from '@woven-deep/content';
import {
  ATTRIBUTE_ORDER, HERO_NAME_RULES, deriveActorStats, pointBuyCost, rerollAttributes, rollAttributes,
  type AttributeName, type AttributeRoll, type BaseAttributes, type DerivedActorStats, type DerivedStatModifier,
  type HeroChoices, type OpaqueId, type Uint32State,
} from '@woven-deep/engine';

/** Portrait glyph ids; `apps/web/src/styles.css` maps each id to an accent color for rendering. */
export const PORTRAIT_GLYPHS = ['@', '@·gold', '@·ember', '@·mist', '@·moss'] as const;

const MAX_TRAITS = 2;

export interface WizardState {
  readonly step: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  readonly name: string;
  readonly portraitGlyph: string;
  readonly method: 'roll' | 'point-buy' | null;
  readonly attributes: BaseAttributes | null;
  readonly rollState: AttributeRoll | null;
  readonly rerollUsed: boolean;
  readonly classId: OpaqueId | null;
  readonly kitId: string | null;
  readonly backgroundId: OpaqueId | null;
  readonly traitIds: readonly OpaqueId[];
  /** Step 1's "Show guidance on your first delve" checkbox -- seeded from `Settings.onboarding`
   * (Task 8) and written back to it at confirm (see `ChargenScreen`'s `onConfirm`). Lives on the
   * wizard itself, not read live from settings, so toggling it mid-wizard doesn't require a round
   * trip through `App`'s settings state. */
  readonly onboardingEnabled: boolean;
}

export type WizardAction =
  | { type: 'set-name'; name: string }
  | { type: 'set-portrait'; glyph: string }
  | { type: 'choose-method'; method: 'roll' | 'point-buy' }
  | { type: 'roll' }
  | { type: 'reroll' }
  | { type: 'set-attribute'; attribute: AttributeName; value: number } // point-buy only
  | { type: 'choose-class'; classId: OpaqueId }
  | { type: 'choose-kit'; kitId: string }
  | { type: 'choose-background'; backgroundId: OpaqueId }
  | { type: 'toggle-trait'; traitId: OpaqueId }
  | { type: 'set-onboarding-enabled'; enabled: boolean }
  | { type: 'next' }
  | { type: 'back' };

export interface WizardContext {
  readonly pack: CompiledContentPack;
  readonly seed: Uint32State;
}

/**
 * The seed is not retained on `WizardState` itself — every `wizardReduce` call takes it fresh via
 * `context.seed`, so the caller (the chargen screen) is what "retains" it across dispatches, e.g.
 * in a `useMemo`/`useRef`. `initialWizardState` still takes `seed` so its signature mirrors
 * `wizardReduce`'s and callers can construct both from the same value.
 */
export function initialWizardState(seed: Uint32State, onboardingEnabled = true): WizardState {
  void seed;
  return {
    step: 1,
    name: '',
    portraitGlyph: PORTRAIT_GLYPHS[0],
    method: null,
    attributes: null,
    rollState: null,
    rerollUsed: false,
    classId: null,
    kitId: null,
    backgroundId: null,
    traitIds: [],
    onboardingEnabled,
  };
}

function balanceOf(pack: CompiledContentPack): BalanceContentEntry | undefined {
  return pack.entries.find((entry): entry is BalanceContentEntry => entry.kind === 'balance');
}

function classOf(pack: CompiledContentPack, classId: OpaqueId): ClassContentEntry | undefined {
  return pack.entries.find((entry): entry is ClassContentEntry => entry.kind === 'class' && entry.id === classId);
}

function backgroundOf(pack: CompiledContentPack, backgroundId: OpaqueId): BackgroundContentEntry | undefined {
  return pack.entries.find(
    (entry): entry is BackgroundContentEntry => entry.kind === 'background' && entry.id === backgroundId,
  );
}

function traitOf(pack: CompiledContentPack, traitId: OpaqueId): TraitContentEntry | undefined {
  return pack.entries.find((entry): entry is TraitContentEntry => entry.kind === 'trait' && entry.id === traitId);
}

function normalizedName(name: string): string {
  return name.trim().normalize('NFC');
}

function nameIsValid(name: string): boolean {
  const normalized = normalizedName(name);
  return normalized.length >= HERO_NAME_RULES.minLength
    && normalized.length <= HERO_NAME_RULES.maxLength
    && HERO_NAME_RULES.pattern.test(normalized);
}

function stepSatisfied(state: WizardState): boolean {
  switch (state.step) {
    case 1: return nameIsValid(state.name);
    case 2: return state.method !== null;
    case 3: return state.attributes !== null;
    case 4: return state.classId !== null;
    case 5: return state.kitId !== null;
    case 6: return state.backgroundId !== null;
    case 7: return false;
  }
}

export function wizardReduce(state: WizardState, action: WizardAction, context: WizardContext): WizardState {
  switch (action.type) {
    case 'set-name':
      return { ...state, name: action.name };

    case 'set-portrait': {
      const glyphs: readonly string[] = PORTRAIT_GLYPHS;
      if (!glyphs.includes(action.glyph)) return state;
      return { ...state, portraitGlyph: action.glyph };
    }

    case 'choose-method': {
      // `rerollUsed` is intentionally NOT reset here: switching methods clears `rollState`
      // (there's nothing left to reroll), but "one reroll means one" is a whole-wizard-session
      // limit, enforced by the reducer itself — a player must not be able to regain a spent
      // reroll just by toggling the method away and back. A fresh `roll` dispatch, which starts
      // an entirely new roll, is what legitimately resets it (see the `roll` case below).
      if (state.method === action.method) return state;
      if (action.method === 'point-buy') {
        const balance = balanceOf(context.pack);
        if (!balance) return state;
        const attributes = Object.fromEntries(
          ATTRIBUTE_ORDER.map((attributeName) => [attributeName, balance.attributeMinimum]),
        ) as unknown as BaseAttributes;
        return { ...state, method: action.method, attributes, rollState: null };
      }
      return { ...state, method: action.method, attributes: null, rollState: null };
    }

    case 'roll': {
      if (state.method !== 'roll') return state;
      const rolled = rollAttributes(context.seed);
      return { ...state, attributes: rolled.attributes, rollState: rolled, rerollUsed: false };
    }

    case 'reroll': {
      if (state.method !== 'roll' || state.rollState === null || state.rerollUsed) return state;
      const rerolled = rerollAttributes(state.rollState);
      return { ...state, attributes: rerolled.attributes, rollState: rerolled, rerollUsed: true };
    }

    case 'set-attribute': {
      if (state.method !== 'point-buy' || state.attributes === null) return state;
      const balance = balanceOf(context.pack);
      if (!balance) return state;
      if (action.value < balance.attributeMinimum || action.value > balance.attributeMaximum) return state;
      const candidate = { ...state.attributes, [action.attribute]: action.value };
      let cost: number;
      try {
        cost = pointBuyCost(candidate, balance.pointBuy);
      } catch {
        return state;
      }
      if (cost > balance.pointBuy.budget) return state;
      return { ...state, attributes: candidate };
    }

    case 'choose-class': {
      const entry = classOf(context.pack, action.classId);
      if (!entry || !entry.playable) return state;
      if (state.classId === action.classId) return state;
      return { ...state, classId: action.classId, kitId: null };
    }

    case 'choose-kit': {
      if (state.classId === null) return state;
      const entry = classOf(context.pack, state.classId);
      if (!entry) return state;
      const kit = entry.kits.find((candidate) => candidate.kitId === action.kitId);
      if (!kit) return state;
      return { ...state, kitId: action.kitId };
    }

    case 'choose-background': {
      const entry = backgroundOf(context.pack, action.backgroundId);
      if (!entry) return state;
      return { ...state, backgroundId: action.backgroundId };
    }

    case 'toggle-trait': {
      const entry = traitOf(context.pack, action.traitId);
      if (!entry) return state;
      if (state.traitIds.includes(action.traitId)) {
        return { ...state, traitIds: state.traitIds.filter((traitId) => traitId !== action.traitId) };
      }
      if (state.traitIds.length >= MAX_TRAITS) return state;
      return { ...state, traitIds: [...state.traitIds, action.traitId] };
    }

    case 'set-onboarding-enabled':
      return { ...state, onboardingEnabled: action.enabled };

    case 'next': {
      if (state.step >= 7 || !stepSatisfied(state)) return state;
      return { ...state, step: (state.step + 1) as WizardState['step'] };
    }

    case 'back': {
      if (state.step <= 1) return state;
      return { ...state, step: (state.step - 1) as WizardState['step'] };
    }
  }
}

export function wizardChoices(state: WizardState): HeroChoices | null {
  if (
    state.step !== 7
    || !nameIsValid(state.name)
    || state.method === null
    || state.attributes === null
    || state.classId === null
    || state.kitId === null
    || state.backgroundId === null
  ) return null;

  return {
    name: state.name,
    method: state.method,
    attributes: state.attributes,
    classId: state.classId,
    kitId: state.kitId,
    backgroundId: state.backgroundId,
    traitIds: state.traitIds,
  };
}

/** Live derived-stats preview: mirrors `heroFromChoices`'s modifier merge by handing
 * `deriveActorStats` the background's and each selected trait's modifiers directly as separate
 * `heroModifiers` entries — it sums across all of them per stat, so pre-merging into one object
 * first (as `heroFromChoices` does for the persisted `NewRunHero`) is unnecessary here. */
export function wizardPreview(state: WizardState, pack: CompiledContentPack): DerivedActorStats | null {
  if (state.attributes === null) return null;
  const balance = balanceOf(pack);
  if (!balance) return null;

  const heroModifiers: DerivedStatModifier[] = [];
  if (state.backgroundId !== null) {
    const background = backgroundOf(pack, state.backgroundId);
    if (background) heroModifiers.push(background.modifiers);
  }
  for (const traitId of state.traitIds) {
    const trait = traitOf(pack, traitId);
    if (trait) heroModifiers.push(trait.modifiers);
  }

  return deriveActorStats({
    attributes: state.attributes,
    formulas: balance.formulas,
    equipmentModifiers: [],
    conditionModifiers: [],
    heroModifiers,
  });
}
