import type { SessionSnapshot } from '../src/session/guest-session.js';
import type { CreateRenderer, MountedRenderer } from '../src/ui/playfield/PlayfieldCanvas.js';
import type {
  HoverCursor,
  RendererCallbacks,
  TargetingVisual,
} from '../src/ui/playfield/IsoRenderer.js';

/** One mounted fake renderer, recording everything `PlayfieldCanvas` drove into it and exposing the
 * callbacks it was handed so a test can fire synthetic pointer input straight through them. */
export interface RecordingRenderer extends MountedRenderer {
  readonly callbacks: RendererCallbacks;
  readonly snapshots: SessionSnapshot[];
  readonly targetings: (TargetingVisual | null)[];
  readonly hoverCursors: (HoverCursor | null)[];
  destroyed: boolean;
  /** Simulates a primary/secondary click on `cell` by invoking the recorded click callback. */
  click(cell: { x: number; y: number }, button?: 'primary' | 'secondary'): void;
  /** Simulates the pointer hovering `cell` (or leaving, with `null`). */
  hover(cell: { x: number; y: number } | null, clientX?: number, clientY?: number): void;
  /** The last targeting visual pushed (or `null` if none / cleared). */
  lastTargeting(): TargetingVisual | null;
  /** The last hover cursor pushed (or `null` if none / cleared). */
  lastHoverCursor(): HoverCursor | null;
}

export interface FakePlayfieldRenderer {
  readonly createRenderer: CreateRenderer;
  readonly instances: RecordingRenderer[];
  /** The most recently created instance (the live one after a StrictMode remount). */
  latest(): RecordingRenderer;
}

/**
 * A recording stand-in for `IsoRenderer` used wherever a `PlayScreen`/`PlayfieldCanvas` test needs
 * to observe or drive the renderer without a real WebGL context. `init()` resolves on a microtask
 * (matching the real async boundary), and `click`/`hover` fire the callbacks `PlayfieldCanvas` wired
 * up, so intent-dispatch assertions run through the exact same path a real pointer event would.
 */
export function fakePlayfieldRenderer(): FakePlayfieldRenderer {
  const instances: RecordingRenderer[] = [];

  const createRenderer: CreateRenderer = (_host, _atlas, callbacks) => {
    const snapshots: SessionSnapshot[] = [];
    const targetings: (TargetingVisual | null)[] = [];
    const hoverCursors: (HoverCursor | null)[] = [];
    const instance: RecordingRenderer = {
      callbacks,
      snapshots,
      targetings,
      hoverCursors,
      destroyed: false,
      init: () => Promise.resolve(),
      setSnapshot: (snapshot) => {
        snapshots.push(snapshot);
      },
      setTargeting: (visual) => {
        targetings.push(visual);
      },
      setHoverCursor: (cursor) => {
        hoverCursors.push(cursor);
      },
      destroy: () => {
        instance.destroyed = true;
      },
      click: (cell, button = 'primary') => callbacks.onCellClick(cell, button),
      hover: (cell, clientX = 0, clientY = 0) =>
        callbacks.onCellHover(cell === null ? null : { cell, clientX, clientY }),
      lastTargeting: () => targetings.at(-1) ?? null,
      lastHoverCursor: () => hoverCursors.at(-1) ?? null,
    };
    instances.push(instance);
    return instance;
  };

  return {
    createRenderer,
    instances,
    latest: () => {
      const last = instances.at(-1);
      if (last === undefined) throw new Error('fake renderer was never created');
      return last;
    },
  };
}
