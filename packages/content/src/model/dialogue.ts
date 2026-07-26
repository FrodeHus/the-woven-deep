import type { BaseContentEntry, ContentId } from './common.js';

export type DialogueConsequence =
  | { readonly kind: 'reputation'; readonly factionId: ContentId; readonly amount: number }
  | { readonly kind: 'reveal-lore'; readonly contentId: ContentId }
  | { readonly kind: 'open-trade' };

export interface DialogueTopic {
  readonly id: string;
  readonly prompt: string;
  readonly response: string;
  readonly reveals?: readonly string[];
  readonly consequence?: DialogueConsequence;
  readonly once?: boolean;
}

export interface DialogueContentEntry extends BaseContentEntry {
  readonly kind: 'dialogue';
  readonly greeting: string;
  readonly topics: readonly DialogueTopic[];
}
