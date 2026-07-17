import {
  useEffect, useRef, useState, type CSSProperties, type JSX, type MouseEvent as ReactMouseEvent,
} from 'react';
import type { CompiledContentPack } from '@woven-deep/content';
import type { GameplayProjection, StoredHallRecord } from '@woven-deep/engine';
import type { Sightings } from '../session/codex.js';
import type { GuestSession, SessionSnapshot } from '../session/guest-session.js';
import { useGuestSession } from '../session/store.js';
import { computeCamera, type CameraOrigin } from './camera.js';
import { EffectsLayer } from './EffectsLayer.js';
import { GridRenderer } from './GridRenderer.js';
import { createKeyDispatcher, type OverlayActionId } from './KeyRouter.js';
import { DEFAULT_SETTINGS, resolveKeymap, type ResolvedKeymap, type Settings } from '../session/settings.js';
import {
  layoutTier, viewportForPane, zoomForFloor, type LayoutTier, type ZoomFactor,
} from './layout.js';
import { HeroPanel, LogPanel, StatusBar, ThreatPanel, VitalsStrip } from './panels.js';
import { useDialogFocusTrap } from './overlays/focus-trap.js';
import { OVERLAY_REGISTRY, type OverlayId } from './overlays/registry.js';
import { OVERLAY_COMPONENTS } from './overlays/overlay-components.js';
import { OverlayScaffold } from './overlays/OverlayScaffold.js';
import { OverlayErrorBoundary } from './overlays/OverlayErrorBoundary.js';
import { HouseScreen } from './screens/HouseScreen.js';
import { TradeScreen } from './screens/TradeScreen.js';
import { ThreatPopover, type ThreatPopoverActor } from './ThreatPopover.js';
import { TownPanel } from './TownPanel.js';

interface DecisionPromptProps {
  readonly snapshot: SessionSnapshot;
  readonly session: GuestSession;
}

/** The confirm-aggression prompt: reuses the same dialog primitives as `BackpackMenu` (focus trap,
 * `role="dialog"`), answering with `y`/`n` (or Escape, which declines non-destructively). */
function DecisionPrompt({ snapshot, session }: DecisionPromptProps): JSX.Element | null {
  const containerRef = useRef<HTMLDivElement>(null);
  useDialogFocusTrap(containerRef);
  const decision = snapshot.pendingDecision;
  if (!decision) return null;

  const answer = (confirmed: boolean): void => session.answerDecision(confirmed);

  return (
    <div
      ref={containerRef}
      role="dialog"
      aria-modal="true"
      aria-label="Confirm attack"
      className="decision-prompt"
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key === 'Escape') { event.preventDefault(); answer(false); return; }
        if (event.key === 'y' || event.key === 'Y') { event.preventDefault(); answer(true); return; }
        if (event.key === 'n' || event.key === 'N') { event.preventDefault(); answer(false); }
      }}
    >
      <p>Attack this target?</p>
      <button type="button" onClick={() => answer(true)}>Yes (y)</button>
      <button type="button" onClick={() => answer(false)}>No (n)</button>
    </div>
  );
}

export interface PlayScreenProps {
  readonly session: GuestSession;
  readonly pack: CompiledContentPack;
  /** Test-only escape hatch: forces a tier instead of deriving it from measured pane width, so
   * tier-dependent composition is assertable without simulating a real ResizeObserver layout. */
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
  /** The resolved keymap driving both movement/action routing and the six overlay-open keys.
   * Defaults to the default bindings so existing callers (which never rebind anything) are
   * unaffected. */
  readonly keymap?: ResolvedKeymap;
  /** Forwarded straight through to the settings overlay body (`SettingsOverlayBody` in
   * `overlay-components.tsx`) when it's the one open -- `App` owns the actual settings state and
   * persistence; `PlayScreen` just plumbs these past the overlay host, exactly like `keymap`
   * above. Defaults keep every pre-existing caller/test (which never opens the settings overlay)
   * compiling unchanged. */
  readonly settings?: Settings;
  readonly onChangeSettings?: (next: Settings) => void;
  readonly onClearGuestSession?: () => void;
  /** Forwarded straight through to the codex overlay body (`CodexOverlayBody`) when it's the one
   * open -- `codex` is `global`-scope, so it can open mid-play too. `App` (via `GameRoot`) owns the
   * Hall repository and the sighting-cache storage read; `PlayScreen` just plumbs these past the
   * overlay host, exactly like `settings`/`keymap` above. Defaults keep every pre-existing
   * caller/test (which never opens the codex overlay) compiling unchanged. */
  readonly records?: readonly StoredHallRecord[];
  readonly sightings?: Sightings;
}

interface PositionedActor extends ThreatPopoverActor { readonly x: number; readonly y: number }

function actorAtCell(projection: GameplayProjection, x: number, y: number): PositionedActor | undefined {
  return (projection.actors as unknown as readonly PositionedActor[])
    .find((actor) => actor.x === x && actor.y === y);
}

function parseDataCell(value: string): Readonly<{ x: number; y: number }> | undefined {
  const [xText, yText] = value.split(',');
  const x = Number(xText);
  const y = Number(yText);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return undefined;
  return { x, y };
}

const FALLBACK_CELL_PX = { width: 8, height: 16 };

/**
 * Composes the Tactical Triptych: hero panel, scrolling map, threat panel, and the adventure log,
 * arranged by a CSS grid whose column tracks respond to `data-tier`. Owns the only two pieces of
 * layout state that cannot live in a pure module — measured pane/cell pixel sizes and the
 * previous-floor-keyed camera origin — everything else (tier thresholds, viewport arithmetic, the
 * camera formula itself) is delegated to pure functions so it stays unit-testable without a DOM.
 */
export function PlayScreen({
  session, pack, tier: tierOverride,
  overlay = null, onOpenOverlay = () => {}, onCloseOverlay = () => {},
  keymap = resolveKeymap(DEFAULT_SETTINGS.bindings),
  settings = DEFAULT_SETTINGS, onChangeSettings = () => {}, onClearGuestSession = () => {},
  records = [], sightings = { monsterIds: [], itemIds: [] },
}: PlayScreenProps): JSX.Element {
  const snapshot = useGuestSession(session);
  const { projection } = snapshot;

  const triptychRef = useRef<HTMLDivElement>(null);
  const mapPaneRef = useRef<HTMLDivElement>(null);
  const cellProbeRef = useRef<HTMLSpanElement>(null);
  // A second, un-zoomed probe (fixed at the base font-size, see `.cell-probe-base` in styles.css)
  // used only to feed `zoomForFloor` the 1x cell size — see the effect below for why this is a
  // second measured element rather than dividing `cellProbeRef`'s zoomed measurement by the
  // applied zoom.
  const cellProbeBaseRef = useRef<HTMLSpanElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [paneSize, setPaneSize] = useState({ width: 0, height: 0 });
  const [cellSize, setCellSize] = useState(FALLBACK_CELL_PX);
  const [zoom, setZoom] = useState<ZoomFactor>(1);
  // Mirrors `zoom` state but read synchronously inside the measure callback below (which closes
  // over it once per floor, via the `floorId`-keyed effect), so the callback can compare against
  // the zoom actually applied to the DOM right now without adding `zoom` to that effect's own
  // dependency array (which would tear down/re-attach the pane observer on every zoom change).
  const zoomRef = useRef<ZoomFactor>(1);

  // Tier derivation MUST watch a tier-independent measurement. The triptych container's width
  // does not depend on `data-tier` (only its children's grid columns do), so this observer never
  // feeds back into itself — unlike watching the map pane, whose own column shrinks when the tier
  // changes, which used to oscillate the tier indefinitely at mid-band widths (see layout.ts).
  useEffect(() => {
    const node = triptychRef.current;
    if (!node) return undefined;
    const measure = (): void => {
      setContainerWidth(node.getBoundingClientRect().width);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);

  // The map pane observer feeds `viewportForPane` (cell math for the camera/grid) and the zoom
  // decision — never the tier — see above. Re-runs (tearing down and re-attaching the observer,
  // then measuring immediately) whenever the floor identity changes, not only on a real resize:
  // `zoomForFloor`'s answer depends on the floor's own dimensions (a 34x16 town and a 160x50
  // dungeon floor pick very different zooms in the same pane), and descending/ascending stairs
  // does not itself fire a ResizeObserver notification, so without this dependency the zoom
  // chosen for the PREVIOUS floor would silently keep applying to the new one.
  useEffect(() => {
    const node = mapPaneRef.current;
    if (!node) return undefined;
    const measure = (): void => {
      const paneRect = node.getBoundingClientRect();
      setPaneSize({ width: paneRect.width, height: paneRect.height });
      // `cellProbeRef` reports the CURRENTLY zoomed cell size — this is what the grid/effects
      // layer/popover math are actually rendered at, so it feeds `cellSize` directly.
      const cellRect = cellProbeRef.current?.getBoundingClientRect();
      if (cellRect && cellRect.width > 0 && cellRect.height > 0) {
        setCellSize({ width: cellRect.width, height: cellRect.height });
      }
      // `cellProbeBaseRef` is pinned to the base (1x) font-size regardless of the applied zoom
      // (see `.cell-probe-base` in styles.css), so it reports the 1x cell size `zoomForFloor`
      // needs directly — no algebra recovering it from the zoomed measurement, which would assume
      // font metrics scale perfectly linearly across font-sizes (they don't always, due to
      // hinting/subpixel rounding).
      const baseCellRect = cellProbeBaseRef.current?.getBoundingClientRect();
      if (baseCellRect && baseCellRect.width > 0 && baseCellRect.height > 0) {
        const baseCellPx = { width: baseCellRect.width, height: baseCellRect.height };
        const nextZoom = zoomForFloor({ panePx: paneRect, cellPx: baseCellPx, floor: projection.floor });
        if (nextZoom !== zoomRef.current) {
          zoomRef.current = nextZoom;
          setZoom(nextZoom);
        }
      }
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [projection.floor.floorId]);

  // Applying `--zoom` (below, on `.playfield`) changes the probe's OWN box size (it is pinned to
  // `var(--cell-w)`/`var(--cell-h)`, see styles.css), but that never changes the map pane's own
  // box size, so the ResizeObserver above — which only watches the pane — does not re-fire. This
  // effect re-measures the probe specifically after a zoom change lands, so `cellSize` (read by
  // `viewportForPane` and the popover pixel math) always reflects what is actually on screen.
  useEffect(() => {
    const cellRect = cellProbeRef.current?.getBoundingClientRect();
    if (cellRect && cellRect.width > 0 && cellRect.height > 0) {
      setCellSize({ width: cellRect.width, height: cellRect.height });
    }
  }, [zoom]);

  // The single global keydown listener: `createKeyDispatcher` translates keys to intents via the
  // pure `routeKey` and forwards them to the session, rate-limiting OS key auto-repeat so it
  // can't outpace what the player can perceive (see `KeyRouter.ts`'s input-flood guard).
  useEffect(() => {
    const dispatcher = createKeyDispatcher(
      {
        dispatch: (intent) => session.dispatch(intent),
        openOverlay: (overlayActionId) => onOpenOverlay(overlayActionId),
        closeOverlay: () => {
          // `inventory` is a registry overlay like every other one now (Task 5 absorbed the old
          // standalone `BackpackMenu`/`backpackOpen` toggle into the same `overlay` field), so
          // this first branch already covers it.
          if (overlay !== null) { onCloseOverlay(); return; }
          if (snapshot.houseOpen) session.setHouseOpen(false);
          // Unlike the house overlay (a pure client-side toggle), an open trade session is engine
          // state (`projection.trade`): closing it means dispatching `trade-close`, not flipping a
          // local flag -- the screen unmounts once the resulting projection clears `trade`.
          else if (projection.trade) session.dispatch({ type: 'trade-close' });
          else if (snapshot.pendingDecision) session.answerDecision(false);
        },
      },
      () => overlay !== null || snapshot.houseOpen || projection.trade !== undefined
        || snapshot.pendingDecision !== null,
      () => keymap,
    );
    window.addEventListener('keydown', dispatcher);
    return () => window.removeEventListener('keydown', dispatcher);
  }, [
    session, snapshot.houseOpen, projection.trade, snapshot.pendingDecision,
    overlay, onOpenOverlay, onCloseOverlay, keymap,
  ]);

  const tier = tierOverride ?? layoutTier(containerWidth);
  const viewport = viewportForPane({ panePx: paneSize, cellPx: cellSize, floor: projection.floor });

  const cameraRef = useRef<Readonly<{ floorId: string; origin: CameraOrigin }> | null>(null);
  const heroPosition = projection.hero as unknown as { x: number; y: number; sightRadius: number };
  const previousOrigin = cameraRef.current?.floorId === projection.floor.floorId ? cameraRef.current.origin : null;
  const camera = computeCamera({
    hero: heroPosition,
    sightRadius: heroPosition.sightRadius,
    floor: projection.floor,
    viewport,
    previous: previousOrigin,
  });
  cameraRef.current = { floorId: projection.floor.floorId, origin: camera };

  const [hover, setHover] = useState<Readonly<{ actor: PositionedActor }> | null>(null);
  const popoverEnabled = tier !== 'full';

  useEffect(() => {
    setHover(null);
  }, [snapshot]);

  useEffect(() => {
    if (!popoverEnabled) return undefined;
    const dismiss = (): void => setHover(null);
    window.addEventListener('scroll', dismiss, true);
    return () => window.removeEventListener('scroll', dismiss, true);
  }, [popoverEnabled]);

  const handleMouseOver = (event: ReactMouseEvent<HTMLDivElement>): void => {
    if (!popoverEnabled) return;
    const cellElement = (event.target as HTMLElement).closest('[data-cell]');
    if (!cellElement) return;
    const cell = parseDataCell(cellElement.getAttribute('data-cell') ?? '');
    if (!cell) return;
    const actor = actorAtCell(projection, cell.x, cell.y);
    setHover(actor ? { actor } : null);
  };

  const handleMouseLeave = (): void => {
    if (popoverEnabled) setHover(null);
  };

  const logLines = tier === 'minimal' ? 3 : 6;

  return (
    <div className="triptych" data-tier={tier} ref={triptychRef}>
      <div className="status-slot">
        <StatusBar snapshot={snapshot} />
      </div>

      <div className="hero-slot">
        {tier === 'minimal' ? (
          <details className="hero-drawer">
            <summary>Hero</summary>
            <HeroPanel snapshot={snapshot} />
          </details>
        ) : (
          <HeroPanel snapshot={snapshot} />
        )}
      </div>

      <div
        className="map-pane"
        ref={mapPaneRef}
        onMouseOver={handleMouseOver}
        onMouseLeave={handleMouseLeave}
      >
        {tier === 'minimal' && (
          <div className="vitals-overlay">
            <VitalsStrip snapshot={snapshot} />
          </div>
        )}
        <div className="playfield" style={{ '--zoom': zoom } as CSSProperties}>
          <span ref={cellProbeRef} className="cell cell-probe" aria-hidden="true">0</span>
          <span ref={cellProbeBaseRef} className="cell cell-probe-base" aria-hidden="true">0</span>
          <GridRenderer projection={projection} camera={camera} viewport={viewport} />
          <EffectsLayer
            projection={projection} pack={pack} lastEvents={snapshot.lastEvents} camera={camera} viewport={viewport}
          />
        </div>
        {hover && (
          <ThreatPopover
            actor={hover.actor}
            col={hover.actor.x - camera.x}
            row={hover.actor.y - camera.y}
            paneCols={viewport.width}
            paneRows={viewport.height}
            cellPx={cellSize}
          />
        )}
      </div>

      <div className="threat-slot">
        {tier === 'full' ? (
          projection.floor.town ? <TownPanel snapshot={snapshot} /> : <ThreatPanel snapshot={snapshot} />
        ) : (
          <details className="threat-drawer">
            <summary>{projection.floor.town ? 'Town' : 'Threats'}</summary>
            {projection.floor.town ? <TownPanel snapshot={snapshot} /> : <ThreatPanel snapshot={snapshot} />}
          </details>
        )}
      </div>

      <div className="log-slot" style={{ '--log-lines': logLines } as CSSProperties}>
        <LogPanel snapshot={snapshot} />
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
      {overlay && (() => {
        const OverlayBody = OVERLAY_COMPONENTS[overlay];
        return (
          <OverlayScaffold
            title={OVERLAY_REGISTRY[overlay].title}
            onClose={onCloseOverlay}
            testId={`overlay-${overlay}`}
          >
            <OverlayErrorBoundary>
              <OverlayBody
                settings={settings}
                onChangeSettings={onChangeSettings}
                onClearGuestSession={onClearGuestSession}
                keymap={keymap}
                pack={pack}
                snapshot={snapshot}
                onDispatch={(intent) => session.dispatch(intent)}
                records={records}
                sightings={sightings}
              />
            </OverlayErrorBoundary>
          </OverlayScaffold>
        );
      })()}
    </div>
  );
}
