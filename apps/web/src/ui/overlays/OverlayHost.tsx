import type { JSX } from 'react';
import type { CompiledContentPack } from '@woven-deep/content';
import type { StoredHallRecord } from '@woven-deep/engine';
import type { Sightings } from '../../session/codex.js';
import type { SessionSnapshot } from '../../session/guest-session.js';
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
import { CodexOverlay } from './CodexOverlay.js';
import { SettingsOverlay } from './SettingsOverlay.js';
import { HelpOverlay } from './HelpOverlay.js';

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
    sightings: sightings ?? sessionCtx?.snapshot.sightings,
    onBeginScrollTargeting,
    onClose,
  });

  const onOpenChange = (open: boolean): void => {
    if (!open) onClose();
  };

  if (SHEET_OVERLAYS.has(overlay)) {
    return (
      <Sheet open onOpenChange={onOpenChange}>
        <SheetContent side="right" data-testid={`overlay-${overlay}`}>
          <SheetHeader>
            <SheetTitle>{definition.title}</SheetTitle>
          </SheetHeader>
          <OverlayErrorBoundary>{body}</OverlayErrorBoundary>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent data-testid={`overlay-${overlay}`}>
        <DialogHeader>
          <DialogTitle>{definition.title}</DialogTitle>
        </DialogHeader>
        <OverlayErrorBoundary>{body}</OverlayErrorBoundary>
      </DialogContent>
    </Dialog>
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
  readonly sightings: Sightings | undefined;
  readonly onBeginScrollTargeting:
    | ((
        itemId: string,
        spell: Pick<CastableSpellView, 'spellId' | 'name' | 'range' | 'targetingId' | 'aoe'>,
      ) => void)
    | undefined;
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
  }
}
