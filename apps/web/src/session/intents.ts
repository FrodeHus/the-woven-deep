import type { Direction, OpaqueId } from '@woven-deep/engine';

/**
 * The finite set of things a guest player can express through the UI. These are intentionally
 * decoupled from `GameCommand`: an intent describes *what the player wants*, while the command
 * builder decides *which command, if any, achieves it* given the current projection.
 */
export type PlayerIntent =
  | { readonly type: 'move'; readonly direction: Direction }
  | { readonly type: 'wait' }
  | { readonly type: 'rest' }
  | { readonly type: 'pickup' }
  | { readonly type: 'descend' }
  | {
    readonly type: 'backpack';
    readonly action: 'equip' | 'use' | 'drop' | 'toggle-light';
    readonly itemId: OpaqueId;
  };
