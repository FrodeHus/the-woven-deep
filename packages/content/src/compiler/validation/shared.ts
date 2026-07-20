import type { z } from 'zod';
import type { ClassKitBackpackItem, ContentEntry, EffectDefinition } from '../../model.js';
import type { ContentCompileIssue } from '../error.js';
import { EFFECT_PARAMETER_SCHEMAS } from '../registries.js';

export interface LocatedContentEntry {
  readonly entry: ContentEntry;
  readonly file: string;
}

export function compareCodeUnits(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

export function issue(file: string, path: string, message: string): ContentCompileIssue {
  return { file, path, message };
}

export function validateParameters(
  file: string,
  path: string,
  identifier: string,
  parameters: Readonly<Record<string, unknown>>,
  schemas: Readonly<Record<string, z.ZodTypeAny>>,
  label: string,
): ContentCompileIssue[] {
  const schema = schemas[identifier];
  if (!schema) return [issue(file, path, `unregistered ${label} ${identifier}`)];
  const result = schema.safeParse(parameters);
  if (result.success) return [];
  return result.error.issues.map((problem) =>
    issue(
      file,
      `${path}.parameters${problem.path.length > 0 ? `.${problem.path.join('.')}` : ''}`,
      problem.message,
    ),
  );
}

function conditionReferenceIssues(
  file: string,
  path: string,
  effect: EffectDefinition,
  byId: ReadonlyMap<string, ContentEntry>,
): ContentCompileIssue[] {
  if (effect.effectId !== 'effect.condition.apply' && effect.effectId !== 'effect.condition.remove')
    return [];
  const conditionId = effect.parameters.conditionId;
  const target = typeof conditionId === 'string' ? byId.get(conditionId) : undefined;
  if (!target)
    return [
      issue(
        file,
        `${path}.parameters.conditionId`,
        `unknown condition reference ${String(conditionId)}`,
      ),
    ];
  if (target.kind !== 'condition') {
    return [
      issue(
        file,
        `${path}.parameters.conditionId`,
        `condition reference ${conditionId} resolves to ${target.kind}`,
      ),
    ];
  }
  if (effect.effectId !== 'effect.condition.apply') return [];
  const duration = effect.parameters.duration;
  if (target.duration.mode === 'permanent' && duration !== undefined) {
    return [
      issue(file, `${path}.parameters.duration`, 'permanent condition rejects a duration override'),
    ];
  }
  if (
    target.duration.mode === 'timed' &&
    typeof duration === 'number' &&
    duration > target.duration.maximum
  ) {
    return [
      issue(
        file,
        `${path}.parameters.duration`,
        `duration ${duration} exceeds maximum ${target.duration.maximum}`,
      ),
    ];
  }
  return [];
}

export function effectIssues(
  file: string,
  entryId: string,
  effects: readonly EffectDefinition[],
  byId: ReadonlyMap<string, ContentEntry>,
): ContentCompileIssue[] {
  return effects.flatMap((effect, index) => {
    const path = `$.entries.${entryId}.effects.${index}`;
    const parameterIssues = validateParameters(
      file,
      path,
      effect.effectId,
      effect.parameters,
      EFFECT_PARAMETER_SCHEMAS,
      'effect',
    );
    return parameterIssues.length > 0
      ? parameterIssues
      : conditionReferenceIssues(file, path, effect, byId);
  });
}

export function effectsAtPath(
  file: string,
  path: string,
  effects: readonly EffectDefinition[],
  byId: ReadonlyMap<string, ContentEntry>,
): ContentCompileIssue[] {
  return effects.flatMap((effect, index) => {
    const effectPath = `${path}.${index}`;
    const parameterIssues = validateParameters(
      file,
      effectPath,
      effect.effectId,
      effect.parameters,
      EFFECT_PARAMETER_SCHEMAS,
      'effect',
    );
    return parameterIssues.length > 0
      ? parameterIssues
      : conditionReferenceIssues(file, effectPath, effect, byId);
  });
}

export function referencedKindIssue(
  file: string,
  path: string,
  id: string,
  kind: ContentEntry['kind'],
  byId: ReadonlyMap<string, ContentEntry>,
): ContentCompileIssue[] {
  const target = byId.get(id);
  if (!target) return [issue(file, path, `unknown ${kind} reference ${id}`)];
  if (target.kind !== kind)
    return [issue(file, path, `${kind} reference ${id} resolves to ${target.kind}`)];
  return [];
}

export function buildById(
  locatedEntries: readonly LocatedContentEntry[],
): ReadonlyMap<string, ContentEntry> {
  return new Map(locatedEntries.map(({ entry }) => [entry.id, entry]));
}

export function backpackItemIssues(
  file: string,
  path: string,
  items: readonly ClassKitBackpackItem[],
  byId: ReadonlyMap<string, ContentEntry>,
): ContentCompileIssue[] {
  return items.flatMap((backpackItem, index) => {
    const target = byId.get(backpackItem.contentId);
    if (!target)
      return [
        issue(
          file,
          `${path}.${index}.contentId`,
          `unknown item reference ${backpackItem.contentId}`,
        ),
      ];
    if (target.kind !== 'item') {
      return [
        issue(
          file,
          `${path}.${index}.contentId`,
          `item reference ${backpackItem.contentId} resolves to ${target.kind}`,
        ),
      ];
    }
    return [];
  });
}
