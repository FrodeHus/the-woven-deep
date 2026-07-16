import { useEffect, useRef, useState, type CSSProperties, type JSX, type MouseEvent as ReactMouseEvent } from 'react';
import type { CompiledContentPack } from '@woven-deep/content';
import type { GameplayProjection } from '@woven-deep/engine';
import type { GuestSession } from '../session/guest-session.js';
import { useGuestSession } from '../session/store.js';
import { computeCamera, type CameraOrigin } from './camera.js';
import { EffectsLayer } from './EffectsLayer.js';
import { GridRenderer } from './GridRenderer.js';
import { layoutTier, viewportForPane, type LayoutTier } from './layout.js';
import { HeroPanel, LogPanel, StatusBar, ThreatPanel, VitalsStrip } from './panels.js';
import { ThreatPopover, type ThreatPopoverActor } from './ThreatPopover.js';

export interface PlayScreenProps {
  readonly session: GuestSession;
  readonly pack: CompiledContentPack;
  /** Test-only escape hatch: forces a tier instead of deriving it from measured pane width, so
   * tier-dependent composition is assertable without simulating a real ResizeObserver layout. */
  readonly tier?: LayoutTier;
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
export function PlayScreen({ session, pack, tier: tierOverride }: PlayScreenProps): JSX.Element {
  const snapshot = useGuestSession(session);
  const { projection } = snapshot;

  const mapPaneRef = useRef<HTMLDivElement>(null);
  const cellProbeRef = useRef<HTMLSpanElement>(null);
  const [paneSize, setPaneSize] = useState({ width: 0, height: 0 });
  const [cellSize, setCellSize] = useState(FALLBACK_CELL_PX);

  useEffect(() => {
    const node = mapPaneRef.current;
    if (!node) return undefined;
    const measure = (): void => {
      const paneRect = node.getBoundingClientRect();
      setPaneSize({ width: paneRect.width, height: paneRect.height });
      const cellRect = cellProbeRef.current?.getBoundingClientRect();
      if (cellRect && cellRect.width > 0 && cellRect.height > 0) {
        setCellSize({ width: cellRect.width, height: cellRect.height });
      }
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

  const tier = tierOverride ?? layoutTier(paneSize.width);
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
    <div className="triptych" data-tier={tier}>
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
        <span ref={cellProbeRef} className="cell cell-probe" aria-hidden="true">0</span>
        {tier === 'minimal' && (
          <div className="vitals-overlay">
            <VitalsStrip snapshot={snapshot} />
          </div>
        )}
        <div className="playfield">
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
          <ThreatPanel snapshot={snapshot} />
        ) : (
          <details className="threat-drawer">
            <summary>Threats</summary>
            <ThreatPanel snapshot={snapshot} />
          </details>
        )}
      </div>

      <div className="log-slot" style={{ '--log-lines': logLines } as CSSProperties}>
        <LogPanel snapshot={snapshot} />
      </div>
    </div>
  );
}
