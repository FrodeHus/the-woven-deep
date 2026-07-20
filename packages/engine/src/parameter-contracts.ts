import type { z } from 'zod';
import {
  EFFECT_PARAMETER_SCHEMAS,
  LEADER_RESPONSE_PARAMETER_SCHEMAS,
  SWARM_RESPONSE_PARAMETER_SCHEMAS,
  type EffectDefinition,
  type EffectId,
} from '@woven-deep/content';

export type LeaderResponseId = keyof typeof LEADER_RESPONSE_PARAMETER_SCHEMAS;
export type SwarmResponseId = keyof typeof SWARM_RESPONSE_PARAMETER_SCHEMAS;

/**
 * Narrows an effect's parameters to the registry-derived shape for its id. Content
 * validation guarantees the shape at compile time, so this is the single safe boundary
 * per effect id rather than a scattered structural cast.
 */
export function parseEffectParameters<K extends EffectId>(
  effect: EffectDefinition,
  effectId: K,
): z.infer<(typeof EFFECT_PARAMETER_SCHEMAS)[K]> {
  return EFFECT_PARAMETER_SCHEMAS[effectId].parse(effect.parameters) as z.infer<
    (typeof EFFECT_PARAMETER_SCHEMAS)[K]
  >;
}

/** Narrows a group leader-death response's parameters to the registry shape for its id. */
export function parseLeaderResponseParameters<K extends LeaderResponseId>(
  responseParameters: Readonly<Record<string, unknown>>,
  responseId: K,
): z.infer<(typeof LEADER_RESPONSE_PARAMETER_SCHEMAS)[K]> {
  return LEADER_RESPONSE_PARAMETER_SCHEMAS[responseId].parse(responseParameters) as z.infer<
    (typeof LEADER_RESPONSE_PARAMETER_SCHEMAS)[K]
  >;
}

/** Narrows a swarm source-destruction response's parameters to the registry shape for its id. */
export function parseSwarmResponseParameters<K extends SwarmResponseId>(
  responseParameters: Readonly<Record<string, unknown>>,
  responseId: K,
): z.infer<(typeof SWARM_RESPONSE_PARAMETER_SCHEMAS)[K]> {
  return SWARM_RESPONSE_PARAMETER_SCHEMAS[responseId].parse(responseParameters) as z.infer<
    (typeof SWARM_RESPONSE_PARAMETER_SCHEMAS)[K]
  >;
}
