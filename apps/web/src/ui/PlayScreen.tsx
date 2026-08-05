import { useEffect, useMemo, useRef, useState, type JSX } from 'react';
import type { CompiledContentPack } from '@woven-deep/content';
import type { HeartLineageRecord, Point, StoredHallRecord } from '@woven-deep/engine';
import type { RunSession } from '../session/run-session.js';
import { useRunSession } from '../session/store.js';
import { actorsOf, dialogueTargetAvailable, tradeIsAvailable } from '../session/projection-view.js';
import { CommandPalette } from './CommandPalette.js';
import { SurrenderConfirm } from './overlays/SurrenderConfirm.js';
import type { OverlayActionId } from './KeyRouter.js';
import { activeHint, HINTS } from '../session/onboarding.js';
import { cellNavigability } from '../session/travel.js';
import type { LayoutTier } from './layout.js';
import {
  ActionBar,
  HeroStatusAnnouncer,
  HintFloat,
  LogPanel,
  MinimapPanel,
  TopBar,
} from './panels.js';
import type { OverlayId } from './overlays/registry.js';
import type { AccountState } from '../session/account.js';
import { DecisionPrompt } from './overlays/DecisionPrompt.js';
import { FinalChamberChoice } from './overlays/FinalChamberChoice.js';
import { OverlayHost } from './overlays/OverlayHost.js';
import { useSettingsCtx } from './providers.js';
import { HouseScreen } from './screens/HouseScreen.js';
import { TradeScreen } from './screens/TradeScreen.js';
import { effectiveReducedMotion, ScreenFade } from './ScreenFade.js';
import { AssetPopover } from './AssetPopover.js';
import { ThreatPopover } from './ThreatPopover.js';
import { TownPanel } from './TownPanel.js';
import { PlayfieldCanvas, type CreateRenderer } from './playfield/PlayfieldCanvas.js';
import type { HoverCursor, TargetingVisual } from './playfield/IsoRenderer.js';
import { useAutoTravel } from './hooks/useAutoTravel.js';
import { useCellHover } from './hooks/useCellHover.js';
import { useCommandPaletteHotkey } from './hooks/useCommandPaletteHotkey.js';
import { usePlayKeyDispatcher } from './hooks/usePlayKeyDispatcher.js';
import { useSpellTargeting } from './hooks/useSpellTargeting.js';

export interface PlayScreenProps {
  readonly session: RunSession;
  readonly pack: CompiledContentPack;
  /** Accepted for API/test compatibility -- Layout A's composition is a fixed CSS grid that never
   * reflows, so it does not vary by tier. */
  readonly tier?: LayoutTier;
  /** The currently open registry overlay, owned by `App` (beside `ScreenState`) -- `null` when
   * none is open. Defaults to `null` so every pre-existing caller of `PlayScreen` (tests included)
   * keeps working unchanged. */
  readonly overlay?: OverlayId | null;
  /** Requests opening one of the six overlay-registry actions -- forwarded to `App`, which applies
   * the scope gating (a `play`-scope id can only open here, which is already guaranteed by
   * `PlayScreen` only ever mounting during a live play session; `App` still re-checks
   * defensively). */
  readonly onOpenOverlay?: (overlay: OverlayActionId) => void;
  readonly onCloseOverlay?: () => void;
  readonly onClearGuestSession?: () => void;
  /** Signs the current profile out -- forwarded straight through to the settings overlay body,
   * exactly like `onClearGuestSession`. Only ever provided for a signed-in `ProfileSession`
   * (`App` omits it for a guest's `GuestSession`, and `SettingsOverlay` simply doesn't render the
   * "Sign out" action when it's absent), since this is the one reachable way to tear down a live
   * `/ws/play` connection from inside a run -- the title screen's own "Sign out" is unreachable
   * once play has started. */
  readonly onSignOut?: (() => void) | undefined;
  /** Permanently deletes the current profile -- forwarded straight through to the settings overlay
   * body, exactly like `onSignOut` (only ever provided for a signed-in `ProfileSession`). */
  readonly onDeleteAccount?: (() => void) | undefined;
  /** Forwarded straight through to the settings overlay body's "Lifetime & achievements" section --
   * only ever provided for a signed-in `ProfileSession` run, exactly like `onSignOut`. Optional so
   * every pre-existing caller/test keeps compiling unchanged (the section just doesn't render
   * without it). */
  readonly account?: AccountState | undefined;
  /** Forwarded straight through to the codex overlay body (`CodexOverlayBody`) when it's the one
   * open -- `codex` is `global`-scope, so it can open mid-play too. `App` (via `GameRoot`) owns the
   * Hall repository; `PlayScreen` just plumbs this past the overlay host. Defaults keep every
   * pre-existing caller/test (which never opens the codex overlay) compiling unchanged. */
  readonly records?: readonly StoredHallRecord[];
  /** The guest's bound-Heart lineage record (`repository.currentHeart()`), forwarded straight to
   * the Final Chamber choice overlay for its predecessor-identity display -- `null` for a guest
   * whose Hall has never recorded a `became-heart` completion. Defaults to `null` so every
   * pre-existing caller/test (none of which reach the Chamber) keeps compiling unchanged. */
  readonly currentHeart?: HeartLineageRecord | null;
  /** Whether the contextual onboarding hint strip may show at all -- `App` computes this
   * from `settings.onboarding` and the quickstart boot flag. Defaults to `true` so every
   * pre-existing caller/test keeps compiling and passing unchanged; those never populate
   * `snapshot.onboarding`'s mastery counts either, so in practice they'd only ever see the
   * `movement` hint, and only while in town. */
  readonly onboardingEnabled?: boolean;
  /** Injection seam for the playfield renderer, threaded to `PlayfieldCanvas`. Defaults to the real
   * `IsoRenderer`; tests pass a recording fake (jsdom has no WebGL). */
  readonly createRenderer?: CreateRenderer;
}

/**
 * Composes the full-bleed HUD: the isometric Pixi playfield fills the viewport (`PlayfieldCanvas`,
 * absolute inset-0) and every piece of chrome floats above it -- the top bar, the top-right minimap,
 * the bottom-left message log, the town panel (town only), and every popover/overlay. Nothing
 * reflows into drawers; overlays open over this shell via `OverlayHost`'s Sheet. The playfield
 * reports pointer input back as cell callbacks; the stateful concerns (the global key dispatcher,
 * cell-hover popover, spell targeting, the ⌘K palette) are each their own hook so this component
 * stays layout + composition. Hero vitals, spells, conditions, and threats live in their overlays
 * and the command palette rather than always-on rail panels.
 */
export function PlayScreen({
  session,
  pack,
  overlay = null,
  onOpenOverlay = () => {},
  onCloseOverlay = () => {},
  onClearGuestSession = () => {},
  onSignOut,
  onDeleteAccount,
  account,
  records = [],
  currentHeart = null,
  onboardingEnabled = true,
  createRenderer,
}: PlayScreenProps): JSX.Element {
  const { settings, keymap } = useSettingsCtx();
  const snapshot = useRunSession(session);
  const { projection } = snapshot;

  // The active onboarding hint, recomputed every render from the live snapshot --
  // `activeHintRef` mirrors it into a ref purely so the key-dispatcher effect below (whose own
  // dependency array must stay stable across every snapshot publish, not just hint changes) can
  // read the CURRENT hint id without re-attaching the window listener on every keystroke's worth
  // of state change. The mirroring happens after commit, never while rendering; the dispatcher only
  // reads it from inside a key event, which is always later than that.
  const hint = activeHint(snapshot.onboarding, HINTS, projection, snapshot, onboardingEnabled);
  const activeHintRef = useRef<string | null>(null);
  useEffect(() => {
    activeHintRef.current = hint?.id ?? null;
  }, [hint]);

  const targeting = useSpellTargeting(session, snapshot);

  const isModalActive =
    overlay !== null ||
    snapshot.houseOpen ||
    projection.trade !== undefined ||
    snapshot.pendingDecision !== null ||
    snapshot.pendingFinalChamberChoice !== null ||
    targeting.activeSpellId !== null;

  // Must run BEFORE `usePlayKeyDispatcher` below: its cancel-on-keydown listener has to register
  // first, or pressing the explore/stairs key would cancel the walk it just started instead of
  // starting it.
  const autoTravel = useAutoTravel({
    session,
    snapshot,
    pack,
    autoPickupConsumables: settings.autoPickupConsumables,
    disabled: isModalActive,
  });

  usePlayKeyDispatcher({
    session,
    overlay,
    houseOpen: snapshot.houseOpen,
    trade: projection.trade,
    pendingDecision: snapshot.pendingDecision,
    pendingFinalChamberChoice: snapshot.pendingFinalChamberChoice,
    onOpenOverlay,
    onCloseOverlay,
    keymap,
    activeHintRef,
    targetingActive: targeting.activeSpellId !== null,
    onStartExplore: autoTravel.startExplore,
    onTravelToStairs: autoTravel.travelToStairs,
  });

  const [paletteOpen, setPaletteOpen] = useCommandPaletteHotkey(isModalActive);
  // Purely local: the confirm dialog is client-side UI state, opened only by the palette entry.
  const [surrenderOpen, setSurrenderOpen] = useState(false);

  const { hover, hoverAtCell } = useCellHover(snapshot);
  // The navigation cursor drawn on the hovered cell. Kept as raw state and suppressed at render time
  // while targeting is active, so the targeting visuals own the overlay uncontested and the cursor
  // reappears on the cell still under the pointer the moment the cast resolves or is cancelled.
  const [hoverCursor, setHoverCursor] = useState<HoverCursor | null>(null);

  const mapPaneRef = useRef<HTMLDivElement>(null);
  const [hoverAnchor, setHoverAnchor] = useState<{
    readonly leftPx: number;
    readonly topPx: number;
    readonly paneWidthPx: number;
    readonly paneHeightPx: number;
  } | null>(null);

  // Cells where an actor caught in the current footprint stands -- surfaced to the renderer so it
  // highlights who gets hit before the player confirms the cast.
  const affectedActorCells = useMemo(() => {
    const keys = new Set<string>();
    for (const actor of actorsOf(projection)) {
      if (targeting.affectedActorIds.has(actor.actorId)) keys.add(`${actor.x},${actor.y}`);
    }
    return keys;
  }, [projection, targeting.affectedActorIds]);

  // The targeting visuals the canvas draws: the footprint at the reticle (`validCells`), the cells
  // where an affected actor stands, and the reticle itself. `null` whenever targeting is inactive.
  const hoverCursorVisual: HoverCursor | null =
    targeting.activeSpellId !== null ? null : hoverCursor;

  const targetingVisual: TargetingVisual | null =
    targeting.activeSpellId !== null
      ? {
          validCells: targeting.validCells,
          affectedCells: affectedActorCells,
          reticle: targeting.reticle,
        }
      : null;

  /**
   * The playfield's cell click. While targeting is active, a primary click confirms the cast at the
   * cell (a click on an invalid cell is ignored -- targeting stays active) and a secondary
   * (right-click) cancels; otherwise a primary click starts click-to-travel, unchanged.
   */
  const handleCellClick = (cell: Point, button: 'primary' | 'secondary'): void => {
    if (targeting.activeSpellId !== null) {
      if (button === 'primary') targeting.confirmAt(cell);
      else targeting.cancel();
      return;
    }
    if (button === 'primary') autoTravel.travelTo(cell);
  };

  /**
   * The playfield's cell hover. Positions the description popover from the pointer's client position
   * (relative to the map pane's own box), resolves the navigation cursor for the cell, and, while an AoE spell is being targeted, drives the free
   * reticle so the footprint follows the mouse -- the keyboard reticle still works for players who
   * never move the mouse.
   */
  const handleCellHover = (
    payload: { cell: Point; clientX: number; clientY: number } | null,
  ): void => {
    if (payload === null) {
      hoverAtCell(null);
      setHoverAnchor(null);
      setHoverCursor(null);
      return;
    }
    hoverAtCell(payload.cell);
    // Navigability is auto-travel's own predicate, not a lookalike: the outline the player sees and
    // the path a click actually walks come from the same `cellNavigability`. An undiscovered cell
    // draws no cursor at all.
    const navigability = cellNavigability(projection, payload.cell);
    setHoverCursor(
      navigability === 'unknown'
        ? null
        : { cell: payload.cell, navigable: navigability === 'navigable' },
    );
    const rect = mapPaneRef.current?.getBoundingClientRect();
    setHoverAnchor({
      leftPx: payload.clientX - (rect?.left ?? 0),
      topPx: payload.clientY - (rect?.top ?? 0),
      paneWidthPx: rect?.width ?? 0,
      paneHeightPx: rect?.height ?? 0,
    });
    if (targeting.activeSpellId !== null) targeting.setReticle(payload.cell);
  };

  return (
    <ScreenFade
      transitionKey={projection.floor.floorId}
      reducedMotion={effectiveReducedMotion(settings.reducedMotion)}
    >
      <div
        className="relative h-screen w-screen overflow-hidden bg-deep text-fg"
        data-testid="play-layout"
        ref={mapPaneRef}
      >
        <div className="absolute inset-0">
          <PlayfieldCanvas
            snapshot={snapshot}
            pack={pack}
            targeting={targetingVisual}
            hoverCursor={hoverCursorVisual}
            onCellClick={handleCellClick}
            onCellHover={handleCellHover}
            {...(createRenderer ? { createRenderer } : {})}
          />
        </div>
        {hover?.kind === 'actor' && hoverAnchor && (
          <ThreatPopover
            actor={hover.actor}
            leftPx={hoverAnchor.leftPx}
            topPx={hoverAnchor.topPx}
            paneWidthPx={hoverAnchor.paneWidthPx}
            paneHeightPx={hoverAnchor.paneHeightPx}
            pack={pack}
          />
        )}
        {hover?.kind === 'asset' && hoverAnchor && (
          <AssetPopover
            asset={hover.asset}
            leftPx={hoverAnchor.leftPx}
            topPx={hoverAnchor.topPx}
            paneWidthPx={hoverAnchor.paneWidthPx}
            paneHeightPx={hoverAnchor.paneHeightPx}
            pack={pack}
          />
        )}

        <TopBar snapshot={snapshot} />
        <HeroStatusAnnouncer snapshot={snapshot} />
        <MinimapPanel snapshot={snapshot} onTravelTo={autoTravel.travelTo} />
        <LogPanel snapshot={snapshot} />
        {projection.floor.town && (
          <div className="pointer-events-auto absolute bottom-3 right-3 z-10 max-h-56 w-56 max-w-[45vw] overflow-y-auto rounded-md border border-line bg-deep/70 p-2 text-sm text-fg backdrop-blur-sm">
            <TownPanel snapshot={snapshot} keymap={keymap} />
          </div>
        )}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex flex-col items-center gap-2">
          <HintFloat hint={hint} keymap={keymap} />
          <div className="pointer-events-auto">
            <ActionBar
              snapshot={snapshot}
              session={session}
              keymap={keymap}
              onBeginCast={targeting.begin}
            />
          </div>
        </div>

        {snapshot.houseOpen && (
          <HouseScreen
            snapshot={snapshot}
            onDispatch={(intent) => session.dispatch(intent)}
            onClose={() => session.setHouseOpen(false)}
          />
        )}
        {projection.trade && (
          <TradeScreen
            snapshot={snapshot}
            onDispatch={(intent) => session.dispatch(intent)}
            onClose={() => session.dispatch({ type: 'trade-close' })}
          />
        )}
        {snapshot.pendingDecision && <DecisionPrompt snapshot={snapshot} session={session} />}
        {snapshot.pendingFinalChamberChoice && (
          <FinalChamberChoice snapshot={snapshot} session={session} currentHeart={currentHeart} />
        )}
        <OverlayHost
          overlay={overlay}
          onClose={onCloseOverlay}
          onBeginScrollTargeting={(itemId, spell) => targeting.beginScroll(itemId, spell)}
          onCastSpell={(spellId) => {
            onCloseOverlay();
            targeting.begin(spellId);
          }}
          isPlayActive
          records={records}
          onClearGuestSession={onClearGuestSession}
          onSignOut={onSignOut}
          onDeleteAccount={onDeleteAccount}
          account={account}
        />
        <CommandPalette
          open={paletteOpen}
          onOpenChange={setPaletteOpen}
          onOpenOverlay={onOpenOverlay}
          isTownContext={projection.floor.town}
          tradeAvailable={tradeIsAvailable(projection)}
          talkAvailable={dialogueTargetAvailable(projection, pack)}
          onCast={targeting.begin}
          onStartExplore={autoTravel.startExplore}
          onTravelToStairs={autoTravel.travelToStairs}
          onSurrender={() => setSurrenderOpen(true)}
        />
        <SurrenderConfirm
          open={surrenderOpen}
          onOpenChange={setSurrenderOpen}
          onConfirm={() => {
            setSurrenderOpen(false);
            session.surrender();
          }}
        />
      </div>
    </ScreenFade>
  );
}
