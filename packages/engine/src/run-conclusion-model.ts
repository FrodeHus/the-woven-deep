import type { CompletionType } from '@woven-deep/content';
import type { OpaqueId } from './model.js';

/**
 * `RunConclusion`/`RunConclusionCause` split out of `run-conclusion.ts` so `model.ts` can reference
 * them without importing `run-conclusion.ts` itself (which imports `actor-model.ts`'s `heroActor`
 * for real, runtime behavior, and `actor-model.ts` in turn type-imports from `model.ts`) -- that
 * back-edge is what used to make the three-file group a runtime circular dependency.
 * `run-conclusion.ts` re-exports both types so every other existing import site keeps working
 * unchanged.
 */
export interface RunConclusionCause {
  readonly killerContentId: OpaqueId | null; // null for non-death completions
  readonly depth: number;
  readonly turn: number;
  readonly worldTime: number;
}

export interface RunConclusion {
  readonly completionType: CompletionType;
  readonly cause: Readonly<RunConclusionCause>;
  readonly concludedAtRevision: number;
  readonly finalized: boolean;
}
