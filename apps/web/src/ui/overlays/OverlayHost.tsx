import type { JSX } from 'react';
import type { CompiledContentPack } from '@woven-deep/content';
import type { StoredHallRecord } from '@woven-deep/engine';
import type { Sightings } from '../../session/codex.js';
import type { SessionSnapshot } from '../../session/guest-session.js';
import type { RunSession } from '../../session/run-session.js';
import type { AccountState } from '../../session/account.js';
import type { CastableSpellView } from '../../session/projection-view.js';
import { canOpenOverlay, OVERLAY_REGISTRY, type OverlayId } from './registry.js';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '../components/sheet.js';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../components/dialog.js';
import { OverlayErrorBoundary } from './OverlayErrorBoundary.js';
import { usePack, useSessionCtx } from '../providers.js';
import { InventoryOverlay } from './InventoryOverlay.js';
import { CharacterSheetOverlay } from './CharacterSheetOverlay.js';
import { MapJournalOverlay } from './MapJournalOverlay.js';
import { SpellbookOverlay } from './SpellbookOverlay.js';
import { CodexOverlay } from './CodexOverlay.js';
import { SettingsOverlay } from './SettingsOverlay.js';
import { HelpOverlay } from './HelpOverlay.js';
import { DialogueScreen } from '../screens/DialogueScreen.js';

const SHEET_OVERLAYS: ReadonlySet<OverlayId> = new Set([
  'inventory',
  'character-sheet',
  'map-journal',
]);

export interface OverlayHostProps {
  readonly overlay: OverlayId | null;
  readonly onClose: () => void;
  readonly isPlayActive: boolean;
  readonly records?: readonly StoredHallRecord[];
  readonly onClearGuestSession?: () => void;
  /** Signs the current profile out -- forwarded to the settings overlay body alongside
   * `onClearGuestSession`. See `PlayScreenProps.onSignOut`'s doc comment for why this is the one
   * reachable "sign out" while a `ProfileSession` run is live. */
  readonly onSignOut?: (() => void) | undefined;
  /** Permanently deletes the current profile -- forwarded to the settings overlay body alongside
   * `onSignOut`. See `SettingsOverlayProps.onDeleteAccount`'s doc comment. */
  readonly onDeleteAccount?: (() => void) | undefined;
  /** Explicit override for the codex body's sightings, taking precedence over the live session's
   * `snapshot.sightings` -- the title screen has no session (see `App.tsx`'s TITLE-screen
   * `OverlayHost` call site), so it passes the guest's persisted cross-run sighting cache
   * (`session/codex.ts`'s `loadSightings`) directly here instead. Unset on the play path, where
   * the live session already provides sightings via context. */
  readonly sightings?: Sightings;
  /** Forwarded straight through to the settings overlay body -- drives its signed-in-only
   * "Lifetime & achievements" section. Optional so every pre-existing caller/test keeps compiling
   * unchanged (the section just doesn't render without it). */
  readonly account?: AccountState | undefined;
  /** Forwarded straight through to the inventory overlay body -- enters the shared spell-targeting
   * mode for a targeted scroll instead of dispatching `use` immediately (Task 6). Optional so every
   * pre-existing caller/test (none of which open the inventory to a targeted scroll) keeps
   * compiling unchanged. */
  readonly onBeginScrollTargeting?: (
    itemId: string,
    spell: Pick<CastableSpellView, 'spellId' | 'name' | 'range' | 'targetingId' | 'aoe'>,
  ) => void;
  /** Forwarded straight through to the spellbook overlay body -- enters the shared spell-targeting
   * mode for the selected spell, the same path the always-on HUD `SpellsPanel` uses. Optional so
   * every pre-existing caller/test (none of which open the spellbook) keeps compiling unchanged. */
  readonly onCastSpell?: (spellId: string) => void;
}

/**
 * Renders whichever overlay body is current for `overlay`, framed by the Sheet primitive
 * (inventory/character-sheet/map-journal) or the Dialog primitive (codex/settings/help). The
 * primitive itself owns open/close, focus trapping, and Escape -- `onOpenChange` routes a
 * primitive-initiated dismissal back through the SAME `onClose` callback the caller's own
 * `closeOverlay`/`onCloseOverlay` already uses, so it stays a single source of truth regardless of
 * whether the close came from Escape, the scrim, or the close button.
 */
export function OverlayHost({
  overlay,
  onClose,
  isPlayActive,
  records,
  onClearGuestSession,
  onSignOut,
  onDeleteAccount,
  sightings,
  account,
  onBeginScrollTargeting,
  onCastSpell,
}: Readonly<OverlayHostProps>): JSX.Element | null {
  const pack = usePack();
  const sessionCtx = useSessionCtx();

  if (overlay === null) return null;
  const definition = OVERLAY_REGISTRY[overlay];
  if (!canOpenOverlay(definition, isPlayActive)) return null;

  const body = renderBody(overlay, {
    pack,
    records,
    onClearGuestSession,
    onSignOut,
    onDeleteAccount,
    account,
    snapshot: sessionCtx?.snapshot,
    session: sessionCtx?.session,
    sightings: sightings ?? sessionCtx?.snapshot.sightings,
    onBeginScrollTargeting,
    onCastSpell,
    onClose,
  });

  const onOpenChange = (open: boolean): void => {
    if (!open) onClose();
  };

  if (SHEET_OVERLAYS.has(overlay)) {
    return (
      <Sheet open onOpenChange={onOpenChange}>
        <SheetContent
          side="right"
          data-testid={`overlay-${overlay}`}
          // The design's Pack & Gear panel is a narrower fixed-width slide-in (~430px) than the
          // other two Sheet-framed overlays (Hero Record, Map & Journal), which keep the shared
          // `sm:max-w-xl` sheet width unchanged -- so this override is scoped to `inventory` only.
          className={overlay === 'inventory' ? 'sm:max-w-[430px]' : undefined}
        >
          <SheetHeader
            className={
              overlay === 'inventory'
                ? 'flex-row items-center justify-between space-y-0'
                : undefined
            }
          >
            <SheetTitle>{definition.title}</SheetTitle>
            {overlay === 'inventory' && (
              <span aria-hidden="true" className="font-mono text-[0.6875rem] text-subtle">
                ✕ esc
              </span>
            )}
          </SheetHeader>
          <OverlayScroll>{body}</OverlayScroll>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      {/* The dialog frame is capped at the viewport and split into a fixed header row plus a
          shrinkable body row, so `OverlayScroll` below has something to scroll inside; without the
          cap a long body (the codex's sighting lists, the help overlay's mechanics notes) grew the
          popup past the screen and clipped. */}
      <DialogContent
        data-testid={`overlay-${overlay}`}
        className="max-h-[85dvh] grid-rows-[auto_minmax(0,1fr)]"
      >
        <DialogHeader>
          <DialogTitle>{definition.title}</DialogTitle>
        </DialogHeader>
        <OverlayScroll>{body}</OverlayScroll>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The scroll container every overlay body sits in. `overflow-y-auto` only ever produces a scrollbar
 * when the body actually outgrows the frame, so a short overlay (help, settings) is unchanged while
 * a long one (the character sheet's attributes + derived stats + conditions, a full pack, the map
 * journal) scrolls instead of running off the bottom edge. `min-h-0` is the load-bearing half: a
 * flex/grid child defaults to a content-sized minimum, which would otherwise push the frame past the
 * viewport and clip rather than scroll.
 */
function OverlayScroll({ children }: Readonly<{ children: JSX.Element }>): JSX.Element {
  return (
    <div data-testid="overlay-scroll" className="min-h-0 flex-1 overflow-y-auto pr-1">
      <OverlayErrorBoundary>{children}</OverlayErrorBoundary>
    </div>
  );
}

interface RenderBodyContext {
  readonly pack: CompiledContentPack;
  readonly records: readonly StoredHallRecord[] | undefined;
  readonly onClearGuestSession: (() => void) | undefined;
  readonly onSignOut: (() => void) | undefined;
  readonly onDeleteAccount: (() => void) | undefined;
  readonly account: AccountState | undefined;
  readonly snapshot: SessionSnapshot | undefined;
  /** The live `RunSession`, threaded through for the `dialogue` body -- `DialogueScreen` dispatches
   * intents and reveals lore straight through the session, exactly like `TradeScreen`/`HouseScreen`
   * do from `PlayScreen` (the difference here is that `DialogueScreen` is mounted from inside
   * `OverlayHost`, which otherwise only ever reads `snapshot`/`sightings` off the session). */
  readonly session: RunSession | undefined;
  readonly sightings: Sightings | undefined;
  readonly onBeginScrollTargeting:
    | ((
        itemId: string,
        spell: Pick<CastableSpellView, 'spellId' | 'name' | 'range' | 'targetingId' | 'aoe'>,
      ) => void)
    | undefined;
  readonly onCastSpell: ((spellId: string) => void) | undefined;
  readonly onClose: () => void;
}

function renderBody(overlay: OverlayId, ctx: RenderBodyContext): JSX.Element {
  switch (overlay) {
    case 'inventory':
      if (!ctx.snapshot) return <p>Your backpack is unavailable right now.</p>;
      return (
        <InventoryOverlay
          onBeginScrollTargeting={ctx.onBeginScrollTargeting}
          onCloseOverlay={ctx.onClose}
        />
      );
    case 'character-sheet':
      if (!ctx.snapshot) return <p>Your character sheet is unavailable right now.</p>;
      return <CharacterSheetOverlay />;
    case 'map-journal':
      if (!ctx.snapshot) return <p>The map and journal are unavailable right now.</p>;
      return <MapJournalOverlay />;
    case 'spellbook':
      if (!ctx.snapshot) return <p>Your spellbook is unavailable right now.</p>;
      return <SpellbookOverlay onCast={ctx.onCastSpell} />;
    case 'codex':
      // Codex renders from the session-less title screen too, so it takes records/snapshot/
      // sightings/pack as explicit props here rather than reading them from session context.
      if (!ctx.records) return <p>The codex is unavailable right now.</p>;
      return (
        <CodexOverlay
          records={ctx.records}
          snapshot={ctx.snapshot ?? null}
          sightings={ctx.sightings ?? { monsterIds: [], itemIds: [], landmarks: [] }}
          pack={ctx.pack}
        />
      );
    case 'settings':
      if (!ctx.onClearGuestSession) return <p>Settings are unavailable right now.</p>;
      return (
        <SettingsOverlay
          onClearGuestSession={ctx.onClearGuestSession}
          onSignOut={ctx.onSignOut}
          onDeleteAccount={ctx.onDeleteAccount}
          account={ctx.account}
        />
      );
    case 'help':
      return <HelpOverlay />;
    case 'dialogue':
      if (!ctx.snapshot || !ctx.session) return <p>There is no one to talk to right now.</p>;
      return (
        <DialogueScreen
          pack={ctx.pack}
          projection={ctx.snapshot.projection}
          onDispatch={(intent) => ctx.session?.dispatch(intent)}
          onRevealLore={(contentId) => ctx.session?.revealLore(contentId)}
          onClose={ctx.onClose}
        />
      );
  }
}
