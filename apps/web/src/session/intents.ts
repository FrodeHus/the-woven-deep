import type { Direction, OpaqueId } from '@woven-deep/engine';
import type { MerchantServiceId } from '@woven-deep/content';

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
  | { readonly type: 'ascend' }
  // Attempts to pick whichever locked door/chest the hero is currently Chebyshev-adjacent to (see
  // command-builder.ts's `adjacentLockedFeature` resolution) -- carries no payload, exactly like
  // `trade-open` resolving its merchant from adjacency, so a bare keypress or affordance click
  // never has to look up a `featureId` itself.
  | { readonly type: 'pick-lock' }
  // Opens the house transfer screen; only accepted when the hero is Chebyshev-adjacent to the
  // town's house door (see command-builder.ts). Carries no payload -- the screen itself dispatches
  // `house-transfer` intents for the actual deposit/withdraw actions.
  | { readonly type: 'house' }
  | {
      readonly type: 'house-transfer';
      readonly action: 'deposit' | 'withdraw';
      readonly itemId: OpaqueId;
      readonly quantity: number;
    }
  | {
      readonly type: 'backpack';
      readonly action: 'equip' | 'unequip' | 'use' | 'drop' | 'toggle-light';
      readonly itemId: OpaqueId;
    }
  // Refuels an equipped light source (`targetItemId`) from a backpack fuel stack
  // (`fuelItemId`) -- see command-builder.ts, which builds the engine's `refuel` command from
  // this, sending the fuel stack's full quantity (the engine clamps to the light's remaining
  // capacity, so no capacity math belongs here).
  | { readonly type: 'refuel'; readonly fuelItemId: OpaqueId; readonly targetItemId: OpaqueId }
  // Opens a trade session with the merchant actor the hero is Chebyshev-adjacent to (see
  // command-builder.ts); dispatches an engine `trade-open` command directly, so the resulting
  // `projection.trade` is what actually drives `TradeScreen`'s presence -- there is no separate
  // client-side "trade open" boolean to track (contrast `house`, which only toggles local UI
  // state).
  | { readonly type: 'trade-open' }
  // Closes the active trade session for whichever merchant `projection.trade` currently names.
  | { readonly type: 'trade-close' }
  | { readonly type: 'trade-buy'; readonly itemId: OpaqueId; readonly quantity: number }
  | { readonly type: 'trade-sell'; readonly itemId: OpaqueId; readonly quantity: number }
  | {
      readonly type: 'trade-service';
      readonly serviceId: MerchantServiceId;
      /** `null` for a targetless service (e.g. the strongbox). */
      readonly targetItemId: OpaqueId | null;
    };
