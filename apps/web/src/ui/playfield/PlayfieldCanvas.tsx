import { useEffect, useRef, useState, type JSX } from 'react';
import type { CompiledContentPack } from '@woven-deep/content';
import type { SessionSnapshot } from '../../session/guest-session.js';
import { ATLAS_URL, parseAtlas, type PlayfieldAtlas } from './atlas.js';
import { IsoRenderer, type RendererCallbacks, type TargetingVisual } from './IsoRenderer.js';

/** The slice of `IsoRenderer` `PlayfieldCanvas` drives -- the injection seam for tests, which
 * supply a recording fake (jsdom has no WebGL, so the real renderer can never mount there). */
export type MountedRenderer = Pick<IsoRenderer, 'init' | 'setSnapshot' | 'setTargeting' | 'destroy'>;

export type CreateRenderer = (
  host: HTMLElement,
  atlas: PlayfieldAtlas,
  callbacks: RendererCallbacks,
  pack: CompiledContentPack,
) => MountedRenderer;

const createIsoRenderer: CreateRenderer = (host, atlas, callbacks, pack) =>
  new IsoRenderer(host, atlas, callbacks, pack);

// The atlas JSON is fetched exactly once for the whole app lifetime, not per mount: it is a static
// asset that never changes, and every playfield instance parses the same shape. A rejected fetch or
// a malformed atlas rejects this promise (and every awaiter) rather than silently rendering nothing.
let atlasPromise: Promise<PlayfieldAtlas> | null = null;

function loadAtlas(): Promise<PlayfieldAtlas> {
  if (atlasPromise === null) {
    atlasPromise = fetch(ATLAS_URL)
      .then((response) => {
        if (!response.ok) {
          throw new Error(`playfield atlas fetch failed: ${response.status} ${ATLAS_URL}`);
        }
        return response.json();
      })
      .then((json) => parseAtlas(json));
  }
  return atlasPromise;
}

export interface PlayfieldCanvasProps {
  readonly snapshot: SessionSnapshot;
  readonly pack: CompiledContentPack;
  readonly targeting: TargetingVisual | null;
  readonly onCellClick: (cell: { x: number; y: number }, button: 'primary' | 'secondary') => void;
  readonly onCellHover: (
    hover: { cell: { x: number; y: number }; clientX: number; clientY: number } | null,
  ) => void;
  /** Defaults to the real `IsoRenderer`; tests inject a recording fake. */
  readonly createRenderer?: CreateRenderer;
}

/**
 * Mounts the PixiJS isometric renderer into a host `<div>` and keeps it fed: one effect owns the
 * renderer's create/init/destroy lifecycle, a second pushes each new `snapshot`, a third pushes each
 * `targeting` change. `init()` is async and `destroy()` is not idempotent, so the mount effect
 * guards a cleanup that fires before init settles (React 19 StrictMode double-invokes effects in
 * dev): the renderer is destroyed exactly once, and `setSnapshot`/`setTargeting` never touch a
 * destroyed instance. Pointer input flows back out through the `onCellClick`/`onCellHover` callbacks
 * (kept in refs so a new render never re-mounts the renderer just to see the latest closures).
 */
export function PlayfieldCanvas({
  snapshot,
  pack,
  targeting,
  onCellClick,
  onCellHover,
  createRenderer = createIsoRenderer,
}: PlayfieldCanvasProps): JSX.Element | null {
  const hostRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<MountedRenderer | null>(null);
  const [atlas, setAtlas] = useState<PlayfieldAtlas | null>(null);
  const [ready, setReady] = useState(false);

  const clickRef = useRef(onCellClick);
  const hoverRef = useRef(onCellHover);
  // Keep the callback refs current without re-mounting the renderer: the renderer holds stable
  // wrappers that read `.current`, so a new render's closures reach it without tearing it down.
  useEffect(() => {
    clickRef.current = onCellClick;
    hoverRef.current = onCellHover;
  });

  useEffect(() => {
    let active = true;
    void loadAtlas().then((loaded) => {
      if (active) setAtlas(loaded);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    if (host === null || atlas === null) return undefined;

    let cancelled = false;
    const callbacks: RendererCallbacks = {
      onCellClick: (cell, button) => clickRef.current(cell, button),
      onCellHover: (hover) => hoverRef.current(hover),
    };
    const renderer = createRenderer(host, atlas, callbacks, pack);

    void Promise.resolve(renderer.init()).then(() => {
      if (cancelled) {
        // Cleanup already ran before init settled: this instance was never registered, so destroy
        // it here (exactly once) rather than leaving an orphaned WebGL context behind.
        renderer.destroy();
        return;
      }
      rendererRef.current = renderer;
      setReady(true);
    });

    return () => {
      cancelled = true;
      if (rendererRef.current === renderer) {
        renderer.destroy();
        rendererRef.current = null;
      }
      setReady(false);
    };
  }, [atlas, pack, createRenderer]);

  useEffect(() => {
    if (ready && rendererRef.current !== null) rendererRef.current.setSnapshot(snapshot);
  }, [ready, snapshot]);

  useEffect(() => {
    if (ready && rendererRef.current !== null) rendererRef.current.setTargeting(targeting);
  }, [ready, targeting]);

  if (atlas === null) return null;
  return <div ref={hostRef} className="h-full w-full" role="grid" aria-label="Dungeon floor" />;
}
