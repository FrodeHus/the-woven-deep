import type { CompletionType } from '@woven-deep/content';
import type { OpaqueId } from './model.js';

export interface RunConclusionCause {
  readonly killerContentId: OpaqueId | null;   // null for non-death completions
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
