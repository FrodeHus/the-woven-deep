import {
  useEffect, useRef, useState, type CSSProperties, type JSX, type MouseEvent as ReactMouseEvent,
} from 'react';
import type { CompiledContentPack } from '@woven-deep/content';
import type { GameplayProjection, StoredHallRecord } from '@woven-deep/engine';
import type { GuestSession, SessionSnapshot } from '../session/guest-session.js';
import { useGuestSession } from '../session/store.js';
import { computeCamera, type CameraOrigin } from './camera.js';
import { EffectsLayer } from './EffectsLayer.js';
import { GridRenderer } from './GridRenderer.js';
import { HintStrip } from './HintStrip.js';
import { createKeyDispatcher, type OverlayActionId } from './KeyRouter.js';
import { activeHint, HINTS } from '../session/onboarding.js';
import { DEFAULT_SETTINGS, resolveKeymap, type ResolvedKeymap, type Settings } from '../session/settings.js';
import { viewportForPane, zoomForFloor, type LayoutTier, type ZoomFactor } from './layout.js';
import { HeroPanel, HeroStatusAnnouncer, LogPanel, MinimapPanel, StatusBar, ThreatPanel } from './panels.js';
import { useDialogFocusTrap } from './overlays/focus-trap.js';
import type { OverlayId } from './overlays/registry.js';
import { OverlayHost } from './overlays/OverlayHost.js';
import { UiProviders } from './providers.js';
import { HouseScreen } from './screens/HouseScreen.js';
import { TradeScreen } from './screens/TradeScreen.js';
import { effectiveReducedMotion, ScreenFade } from './ScreenFade.js';
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
   * Hall repository; `PlayScreen` just plumbs this past the overlay host, exactly like
   * `settings`/`keymap` above. Defaults keep every pre-existing caller/test (which never opens the
   * codex overlay) compiling unchanged. */
  readonly records?: readonly StoredHallRecord[];
  /** Whether the contextual onboarding hint strip (Task 8) may show at all -- `App` computes this
   * from `settings.onboarding` and the quickstart boot flag. Defaults to `true` so every
   * pre-existing caller/test keeps compiling and passing unchanged; those never populate
   * `snapshot.onboarding`'s mastery counts either, so in practice they'd only ever see the
   * `movement` hint, and only while in town. */
  readonly onboardingEnabled?: boolean;
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
 * Composes Layout A: a fixed status bar, the ASCII grid + effects layer as the main focal region,
 * a persistent right rail (hero/vitals, minimap, threat/town panel), and a full-width message log
 * -- none of which reflow as the window resizes; overlays open over this shell via `OverlayHost`'s
 * Sheet. Owns the only two pieces of layout state that cannot live in a pure module — measured
 * pane/cell pixel sizes and the previous-floor-keyed camera origin — everything else (viewport
 * arithmetic, the camera formula itself) is delegated to pure functions so it stays unit-testable
 * without a DOM.
 */
export function PlayScreen({
  session, pack,
  overlay = null, onOpenOverlay = () => {}, onCloseOverlay = () => {},
  keymap = resolveKeymap(DEFAULT_SETTINGS.bindings),
  settings = DEFAULT_SETTINGS, onChangeSettings = () => {}, onClearGuestSession = () => {},
  records = [], onboardingEnabled = true,
}: PlayScreenProps): JSX.Element {
  const snapshot = useGuestSession(session);
  const { projection } = snapshot;

  // The active onboarding hint (Task 8), recomputed every render from the live snapshot --
  // `activeHintRef` mirrors it into a ref purely so the key-dispatcher effect below (whose own
  // dependency array must stay stable across every snapshot publish, not just hint changes) can
  // read the CURRENT hint id without re-attaching the window listener on every keystroke's worth
  // of state change.
  const hint = activeHint(snapshot.onboarding, HINTS, projection, snapshot, onboardingEnabled);
  const activeHintRef = useRef<string | null>(null);
  activeHintRef.current = hint?.id ?? null;

  const mapPaneRef = useRef<HTMLDivElement>(null);
  const cellProbeRef = useRef<HTMLSpanElement>(null);
  // A second, un-zoomed probe (fixed at the base font-size, see `.cell-probe-base` in styles.css)
  // used only to feed `zoomForFloor` the 1x cell size — see the effect below for why this is a
  // second measured element rather than dividing `cellProbeRef`'s zoomed measurement by the
  // applied zoom.
  const cellProbeBaseRef = useRef<HTMLSpanElement>(null);
  const [paneSize, setPaneSize] = useState({ width: 0, height: 0 });
  const [cellSize, setCellSize] = useState(FALLBACK_CELL_PX);
  const [zoom, setZoom] = useState<ZoomFactor>(1);
  // Mirrors `zoom` state but read synchronously inside the measure callback below (which closes
  // over it once per floor, via the `floorId`-keyed effect), so the callback can compare against
  // the zoom actually applied to the DOM right now without adding `zoom` to that effect's own
  // dependency array (which would tear down/re-attach the pane observer on every zoom change).
  const zoomRef = useRef<ZoomFactor>(1);

  // The map pane observer feeds `viewportForPane` (cell math for the camera/grid) and the zoom
  // decision. Re-runs (tearing down and re-attaching the observer, then measuring immediately)
  // whenever the floor identity changes, not only on a real resize:
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
        openOverlay: (overlayActionId) => {
          // Two of the six overlay-open actions are their own onboarding milestones (Task 8) --
          // "inspection"/"inventory" mastery is a one-time open, which never goes through
          // `session.dispatch` at all (opening an overlay is client-side UI state, not a
          // `PlayerIntent`), so it's folded in right here instead.
          if (overlayActionId === 'character-sheet') session.recordOnboardingIntent('open-character-sheet');
          else if (overlayActionId === 'inventory') session.recordOnboardingIntent('open-inventory');
          onOpenOverlay(overlayActionId);
        },
        dismissHint: () => {
          const id = activeHintRef.current;
          if (id) session.dismissOnboardingHint(id);
        },
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

  useEffect(() => {
    setHover(null);
  }, [snapshot]);

  useEffect(() => {
    const dismiss = (): void => setHover(null);
    window.addEventListener('scroll', dismiss, true);
    return () => window.removeEventListener('scroll', dismiss, true);
  }, []);

  const handleMouseOver = (event: ReactMouseEvent<HTMLDivElement>): void => {
    const cellElement = (event.target as HTMLElement).closest('[data-cell]');
    if (!cellElement) return;
    const cell = parseDataCell(cellElement.getAttribute('data-cell') ?? '');
    if (!cell) return;
    const actor = actorAtCell(projection, cell.x, cell.y);
    setHover(actor ? { actor } : null);
  };

  const handleMouseLeave = (): void => setHover(null);

  return (
    <ScreenFade
      transitionKey={projection.floor.floorId}
      reducedMotion={effectiveReducedMotion(settings.reducedMotion)}
    >
      <div className="flex min-h-screen flex-col gap-2 bg-deep p-2 text-fg" data-testid="play-layout">
        <StatusBar snapshot={snapshot} />
        <HeroStatusAnnouncer snapshot={snapshot} />

        <div className="grid min-h-0 flex-1 grid-cols-[1fr_15rem] grid-rows-[1fr_auto] gap-2">
          <div
            className="map-pane relative col-start-1 row-start-1 overflow-hidden"
            ref={mapPaneRef}
            onMouseOver={handleMouseOver}
            onMouseLeave={handleMouseLeave}
          >
            <div
              className={[
                'playfield',
                projection.floor.town ? 'playfield-town' : '',
              ].filter(Boolean).join(' ')}
              style={{ '--zoom': zoom } as CSSProperties}
            >
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

          <aside
            aria-label="Hero status and threats"
            className="col-start-2 row-start-1 flex flex-col gap-2 overflow-y-auto"
          >
            <HeroPanel snapshot={snapshot} />
            <MinimapPanel snapshot={snapshot} />
            {projection.floor.town ? <TownPanel snapshot={snapshot} keymap={keymap} /> : <ThreatPanel snapshot={snapshot} />}
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
        {/* `PlayScreen` supplies its own `UiProviders` from the props it already holds, so
         * `OverlayHost`'s hooks resolve whether `PlayScreen` is mounted standalone or nested inside
         * a caller's own `UiProviders` (e.g. `App`'s, around `GameRoot`) -- nesting two providers
         * with the same values is harmless. */}
        <UiProviders pack={pack} settings={settings} onChangeSettings={onChangeSettings} session={session}>
          <OverlayHost
            overlay={overlay}
            onClose={onCloseOverlay}
            isPlayActive
            records={records}
            onClearGuestSession={onClearGuestSession}
          />
        </UiProviders>
      </div>
    </ScreenFade>
  );
}
