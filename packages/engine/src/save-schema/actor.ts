import { z } from 'zod';
import {
  attributes,
  heroName,
  identifier,
  nullableIdentifier,
  safeNonNegative,
} from './primitives.js';

export const condition = z.strictObject({
  conditionId: identifier,
  sourceActorId: nullableIdentifier,
  appliedAt: safeNonNegative,
  expiresAt: safeNonNegative.nullable(),
  stacks: z.number().int().safe().positive(),
});
export const equipment = z.strictObject({
  'main-hand': nullableIdentifier,
  'off-hand': nullableIdentifier,
  body: nullableIdentifier,
  head: nullableIdentifier,
  hands: nullableIdentifier,
  feet: nullableIdentifier,
  neck: nullableIdentifier,
  'left-ring': nullableIdentifier,
  'right-ring': nullableIdentifier,
});
export const populationIntent = z.enum([
  'approach',
  'attack',
  'hold',
  'regroup',
  'flee',
  'protect',
  'spawn',
  'phase-change',
]);
export const actorGoal = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('actor'), targetActorId: identifier }),
  z.strictObject({
    type: z.literal('cell'),
    floorId: identifier,
    x: safeNonNegative,
    y: safeNonNegative,
  }),
  z.strictObject({
    type: z.literal('formation'),
    populationId: identifier,
    roleId: z.string().min(1).max(80),
    x: safeNonNegative,
    y: safeNonNegative,
  }),
]);
export const lastKnownTarget = z.strictObject({
  targetActorId: identifier,
  floorId: identifier,
  x: safeNonNegative,
  y: safeNonNegative,
  observedAt: safeNonNegative,
  source: z.enum(['sight', 'sound', 'group']),
  observerActorId: identifier,
});
export const investigation = z.strictObject({
  floorId: identifier,
  x: safeNonNegative,
  y: safeNonNegative,
  startedAt: safeNonNegative,
  expiresAt: safeNonNegative.nullable(),
});
export const actorBehaviorState = z.strictObject({
  intent: populationIntent,
  goal: actorGoal.nullable(),
  lastKnownTargets: z.array(lastKnownTarget).readonly(),
  investigation: investigation.nullable(),
});
export const populationPresentation = z.strictObject({
  name: heroName,
  glyph: z.string().refine((value) => [...value].length === 1, 'must be one Unicode glyph'),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  leader: z.boolean(),
});
export const actor = z.strictObject({
  actorId: identifier,
  contentId: identifier,
  playerControlled: z.boolean(),
  floorId: identifier,
  x: safeNonNegative,
  y: safeNonNegative,
  attributes,
  health: safeNonNegative,
  maxHealth: safeNonNegative,
  energy: z.number().int().safe(),
  speed: z.number().int().safe().positive(),
  reactionReady: z.boolean(),
  disposition: z.enum(['friendly', 'neutral', 'hostile']),
  awareActorIds: z.array(identifier).readonly(),
  conditions: z.array(condition).readonly(),
  equipment,
  behaviorId: nullableIdentifier,
  behaviorState: actorBehaviorState,
  populationId: nullableIdentifier,
  populationRoleId: z.string().min(1).max(80).nullable(),
  populationPresentation: populationPresentation.nullable(),
});

import type { ActorState } from '../actor-model.js';
import type { Expect, SchemaMatches } from './drift.js';
type _ActorDrift = Expect<SchemaMatches<z.infer<typeof actor>, ActorState>>;
