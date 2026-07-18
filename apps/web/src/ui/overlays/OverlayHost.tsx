import type { JSX } from 'react';
import type { CompiledContentPack } from '@woven-deep/content';
import type { StoredHallRecord } from '@woven-deep/engine';
import type { Sightings } from '../../session/codex.js';
import type { SessionSnapshot } from '../../session/guest-session.js';
import type { PlayerIntent } from '../../session/intents.js';
import type { ResolvedKeymap, Settings } from '../../session/settings.js';
import { canOpenOverlay, OVERLAY_REGISTRY, type OverlayId } from './registry.js';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '../components/sheet.js';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../components/dialog.js';
import { OverlayErrorBoundary } from './OverlayErrorBoundary.js';
import { usePack, useSessionCtx, useSettingsCtx } from '../providers.js';
import { InventoryOverlay } from './InventoryOverlay.js';
import { CharacterSheetOverlay } from './CharacterSheetOverlay.js';
import { MapJournalOverlay } from './MapJournalOverlay.js';
import { CodexOverlay } from './CodexOverlay.js';
import { SettingsOverlay } from './SettingsOverlay.js';
import { HelpOverlay } from './HelpOverlay.js';

const SHEET_OVERLAYS: ReadonlySet<OverlayId> = new Set(['inventory', 'character-sheet', 'map-journal']);

export interface OverlayHostProps {
  readonly overlay: OverlayId | null;
  readonly onClose: () => void;
  readonly isPlayActive: boolean;
  readonly records?: readonly StoredHallRecord[];
  readonly onClearGuestSession?: () => void;
  /** Explicit override for the codex body's sightings, taking precedence over the live session's
   * `snapshot.sightings` -- the title screen has no session (see `App.tsx`'s TITLE-screen
   * `OverlayHost` call site), so it passes the guest's persisted cross-run sighting cache
   * (`session/codex.ts`'s `loadSightings`) directly here instead. Unset on the play path, where
   * the live session already provides sightings via context. */
  readonly sightings?: Sightings;
}

/**
 * Renders whichever overlay body is current for `overlay`, framed by the Sheet primitive
 * (inventory/character-sheet/map-journal) or the Dialog primitive (codex/settings/help). The
 * primitive itself owns open/close, focus trapping, and Escape -- `onOpenChange` routes a
 * primitive-initiated dismissal back through the SAME `onClose` callback the caller's own
 * `closeOverlay`/`onCloseOverlay` already uses, so it stays a single source of truth regardless of
 * whether the close came from Escape, the scrim, or the close button.
 */
export function OverlayHost({ overlay, onClose, isPlayActive, records, onClearGuestSession, sightings }: Readonly<OverlayHostProps>): JSX.Element | null {
  const pack = usePack();
  const { settings, onChange, keymap } = useSettingsCtx();
  const sessionCtx = useSessionCtx();

  if (overlay === null) return null;
  const definition = OVERLAY_REGISTRY[overlay];
  if (!canOpenOverlay(definition, isPlayActive)) return null;

  const body = renderBody(overlay, {
    pack, settings, onChange, keymap, records, onClearGuestSession,
    snapshot: sessionCtx?.snapshot,
    onDispatch: sessionCtx ? (intent) => sessionCtx.session.dispatch(intent) : undefined,
    sightings: sightings ?? sessionCtx?.snapshot.sightings,
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
  readonly settings: Settings;
  readonly onChange: (next: Settings) => void;
  readonly keymap: ResolvedKeymap;
  readonly records: readonly StoredHallRecord[] | undefined;
  readonly onClearGuestSession: (() => void) | undefined;
  readonly snapshot: SessionSnapshot | undefined;
  readonly onDispatch: ((intent: PlayerIntent) => void) | undefined;
  readonly sightings: Sightings | undefined;
}

function renderBody(overlay: OverlayId, ctx: RenderBodyContext): JSX.Element {
  switch (overlay) {
    case 'inventory':
      if (!ctx.snapshot) return <p>Your backpack is unavailable right now.</p>;
      return <InventoryOverlay />;
    case 'character-sheet':
      if (!ctx.snapshot) return <p>Your character sheet is unavailable right now.</p>;
      return <CharacterSheetOverlay />;
    case 'map-journal':
      if (!ctx.snapshot) return <p>The map and journal are unavailable right now.</p>;
      return <MapJournalOverlay />;
    case 'codex':
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
      return <SettingsOverlay onClearGuestSession={ctx.onClearGuestSession} />;
    case 'help':
      return <HelpOverlay />;
  }
}
