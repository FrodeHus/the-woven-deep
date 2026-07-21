import { useRef, type CSSProperties, type JSX, type MouseEvent as ReactMouseEvent } from 'react';
import type { CompiledContentPack } from '@woven-deep/content';
import type { HeartLineageRecord, StoredHallRecord } from '@woven-deep/engine';
import type { GuestSession } from '../session/guest-session.js';
import { useGuestSession } from '../session/store.js';
import { heroOf, tradeIsAvailable } from '../session/projection-view.js';
import { computeCamera, type CameraOrigin } from './camera.js';
import { CommandPalette } from './CommandPalette.js';
import { EffectsLayer } from './EffectsLayer.js';
import { GridRenderer } from './GridRenderer.js';
import { HintStrip } from './HintStrip.js';
import type { OverlayActionId } from './KeyRouter.js';
import { activeHint, HINTS } from '../session/onboarding.js';
import { viewportForPane, type LayoutTier } from './layout.js';
import {
  HeroPanel,
  HeroStatusAnnouncer,
  LogPanel,
  MinimapPanel,
  SpellsPanel,
  StatusBar,
  ThreatPanel,
} from './panels.js';
import type { OverlayId } from './overlays/registry.js';
import { DecisionPrompt } from './overlays/DecisionPrompt.js';
import { FinalChamberChoice } from './overlays/FinalChamberChoice.js';
import { OverlayHost } from './overlays/OverlayHost.js';
import { useSettingsCtx } from './providers.js';
import { HouseScreen } from './screens/HouseScreen.js';
import { TradeScreen } from './screens/TradeScreen.js';
import { effectiveReducedMotion, ScreenFade } from './ScreenFade.js';
import { AssetPopover } from './AssetPopover.js';
import { CellCursor } from './CellCursor.js';
import { TargetingOverlay } from './TargetingOverlay.js';
import { ThreatPopover } from './ThreatPopover.js';
import { TownPanel } from './TownPanel.js';
import { useAutoTravel } from './hooks/useAutoTravel.js';
import { useCellHover } from './hooks/useCellHover.js';
import { useCommandPaletteHotkey } from './hooks/useCommandPaletteHotkey.js';
import { usePaneMeasurement } from './hooks/usePaneMeasurement.js';
import { usePlayKeyDispatcher } from './hooks/usePlayKeyDispatcher.js';
import { useSpellTargeting } from './hooks/useSpellTargeting.js';

export interface PlayScreenProps {
  readonly session: GuestSession;
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
}

/**
 * Composes Layout A: a fixed status bar, the ASCII grid + effects layer as the main focal region,
 * a persistent right rail (hero/vitals, minimap, threat/town panel), and a full-width message log
 * -- none of which reflow as the window resizes; overlays open over this shell via `OverlayHost`'s
 * Sheet. The measured pane/cell pixel sizes and per-floor zoom live in `usePaneMeasurement`; the
 * five stateful concerns (measurement, the global key dispatcher, cell-hover popover, the ⌘K
 * palette) are each their own hook so this component stays layout + composition.
 */
export function PlayScreen({
  session,
  pack,
  overlay = null,
  onOpenOverlay = () => {},
  onCloseOverlay = () => {},
  onClearGuestSession = () => {},
  records = [],
  currentHeart = null,
  onboardingEnabled = true,
}: PlayScreenProps): JSX.Element {
  const { settings, keymap } = useSettingsCtx();
  const snapshot = useGuestSession(session);
  const { projection } = snapshot;

  // The active onboarding hint, recomputed every render from the live snapshot --
  // `activeHintRef` mirrors it into a ref purely so the key-dispatcher effect below (whose own
  // dependency array must stay stable across every snapshot publish, not just hint changes) can
  // read the CURRENT hint id without re-attaching the window listener on every keystroke's worth
  // of state change.
  const hint = activeHint(snapshot.onboarding, HINTS, projection, snapshot, onboardingEnabled);
  const activeHintRef = useRef<string | null>(null);
  activeHintRef.current = hint?.id ?? null;

  const { mapPaneRef, cellProbeRef, cellProbeBaseRef, paneSize, cellSize, zoom } =
    usePaneMeasurement(projection.floor);

  const targeting = useSpellTargeting(session, snapshot);

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
  });

  const viewport = viewportForPane({ panePx: paneSize, cellPx: cellSize, floor: projection.floor });

  const cameraRef = useRef<Readonly<{ floorId: string; origin: CameraOrigin }> | null>(null);
  const heroPosition = heroOf(projection);
  const previousOrigin =
    cameraRef.current?.floorId === projection.floor.floorId ? cameraRef.current.origin : null;
  const camera = computeCamera({
    hero: heroPosition,
    sightRadius: heroPosition.sightRadius,
    floor: projection.floor,
    viewport,
    previous: previousOrigin,
  });
  cameraRef.current = { floorId: projection.floor.floorId, origin: camera };

  const isModalActive =
    overlay !== null ||
    snapshot.houseOpen ||
    projection.trade !== undefined ||
    snapshot.pendingDecision !== null ||
    snapshot.pendingFinalChamberChoice !== null ||
    targeting.activeSpellId !== null;
  const [paletteOpen, setPaletteOpen] = useCommandPaletteHotkey(isModalActive);

  const { hover, cursor, handlers } = useCellHover(snapshot);
  const autoTravel = useAutoTravel({ session, snapshot, disabled: isModalActive });
  const cursorCol = cursor ? cursor.x - camera.x : 0;
  const cursorRow = cursor ? cursor.y - camera.y : 0;
  const cursorInView =
    cursor !== null &&
    cursorCol >= 0 &&
    cursorCol < viewport.width &&
    cursorRow >= 0 &&
    cursorRow < viewport.height;

  // The mouse cursor doubles as the targeting reticle whenever it sits over a currently-valid
  // target -- otherwise the keyboard reticle (`targeting.reticle`) is what's highlighted. Neither
  // overrides the other; whichever the player is actively using wins.
  const targetingHighlight =
    cursor && targeting.validCells.has(`${cursor.x},${cursor.y}`)
      ? { x: cursor.x, y: cursor.y }
      : targeting.reticle;

  /**
   * The map pane's single click handler: while targeting is active, a click is routed to
   * `targeting.confirmAt` INSTEAD of auto-travel (a click on an invalid cell is simply ignored --
   * targeting stays active -- rather than cancelling the whole mode or auto-travelling underneath
   * it); otherwise it's exactly today's auto-travel click, unchanged.
   */
  const handleMapClick = (event: ReactMouseEvent<HTMLDivElement>): void => {
    if (targeting.activeSpellId) {
      const cellElement = (event.target as HTMLElement).closest('[data-cell]');
      if (!cellElement) return;
      const [xText, yText] = (cellElement.getAttribute('data-cell') ?? '').split(',');
      const x = Number(xText);
      const y = Number(yText);
      if (Number.isFinite(x) && Number.isFinite(y)) targeting.confirmAt({ x, y });
      return;
    }
    autoTravel.onClick(event);
  };

  /** Right-click cancels targeting without casting -- the second of the two documented cancel
   * gestures (Escape is the other, handled by `useSpellTargeting`'s own keydown listener). A no-op
   * (default browser context menu) when targeting isn't active. */
  const handleMapContextMenu = (event: ReactMouseEvent<HTMLDivElement>): void => {
    if (!targeting.activeSpellId) return;
    event.preventDefault();
    targeting.cancel();
  };

  return (
    <ScreenFade
      transitionKey={projection.floor.floorId}
      reducedMotion={effectiveReducedMotion(settings.reducedMotion)}
    >
      <div
        className="flex min-h-screen flex-col gap-2 bg-deep p-2 text-fg"
        data-testid="play-layout"
      >
        <StatusBar snapshot={snapshot} />
        <HeroStatusAnnouncer snapshot={snapshot} />

        <div className="grid min-h-0 flex-1 grid-cols-[1fr_15rem] grid-rows-[1fr_auto] gap-2">
          <div
            className="map-pane relative col-start-1 row-start-1 overflow-hidden"
            ref={mapPaneRef}
            onMouseOver={handlers.onMouseOver}
            onMouseLeave={handlers.onMouseLeave}
            onClick={handleMapClick}
            onContextMenu={handleMapContextMenu}
          >
            <div
              className={['playfield', projection.floor.town ? 'playfield-town' : '']
                .filter(Boolean)
                .join(' ')}
              style={{ '--zoom': zoom } as CSSProperties}
            >
              <span ref={cellProbeRef} className="cell cell-probe" aria-hidden="true">
                0
              </span>
              <span ref={cellProbeBaseRef} className="cell cell-probe-base" aria-hidden="true">
                0
              </span>
              <GridRenderer projection={projection} camera={camera} viewport={viewport} />
              <EffectsLayer
                projection={projection}
                pack={pack}
                lastEvents={snapshot.lastEvents}
                camera={camera}
                viewport={viewport}
              />
            </div>
            {targeting.activeSpellId ? (
              <TargetingOverlay
                floor={projection.floor}
                camera={camera}
                viewport={viewport}
                cellPx={cellSize}
                validCells={targeting.validCells}
                highlighted={targetingHighlight}
              />
            ) : (
              cursor &&
              cursorInView && (
                <CellCursor
                  col={cursorCol}
                  row={cursorRow}
                  reachable={cursor.reachable}
                  cellPx={cellSize}
                />
              )
            )}
            {hover?.kind === 'actor' && (
              <ThreatPopover
                actor={hover.actor}
                col={hover.actor.x - camera.x}
                row={hover.actor.y - camera.y}
                paneCols={viewport.width}
                paneRows={viewport.height}
                cellPx={cellSize}
                pack={pack}
              />
            )}
            {hover?.kind === 'asset' && (
              <AssetPopover
                asset={hover.asset}
                col={hover.asset.x - camera.x}
                row={hover.asset.y - camera.y}
                paneCols={viewport.width}
                paneRows={viewport.height}
                cellPx={cellSize}
                pack={pack}
              />
            )}
          </div>

          <aside
            aria-label="Hero status and threats"
            className="col-start-2 row-start-1 flex flex-col gap-2 overflow-y-auto"
          >
            <HeroPanel snapshot={snapshot} />
            <SpellsPanel snapshot={snapshot} onCast={targeting.begin} />
            <MinimapPanel snapshot={snapshot} />
            {projection.floor.town ? (
              <TownPanel snapshot={snapshot} keymap={keymap} />
            ) : (
              <ThreatPanel snapshot={snapshot} keymap={keymap} pack={pack} />
            )}
          </aside>

          <div className="col-span-2 row-start-2 flex flex-col gap-1">
            <HintStrip hint={hint} keymap={keymap} />
            <LogPanel snapshot={snapshot} />
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
          isPlayActive
          records={records}
          onClearGuestSession={onClearGuestSession}
        />
        <CommandPalette
          open={paletteOpen}
          onOpenChange={setPaletteOpen}
          onOpenOverlay={onOpenOverlay}
          isTownContext={projection.floor.town}
          tradeAvailable={tradeIsAvailable(projection)}
          onCast={targeting.begin}
        />
      </div>
    </ScreenFade>
  );
}
