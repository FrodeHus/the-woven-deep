import type { ComponentType, JSX } from 'react';
import type { OverlayId } from './registry.js';

/**
 * Props passed to whatever component `OVERLAY_COMPONENTS` maps an `OverlayId` to. Both hosts
 * (`App.tsx`'s title-screen entry points and `PlayScreen.tsx`'s in-play entry points) currently
 * pass nothing -- every overlay body is still the same placeholder, with no per-id data or
 * callbacks threaded through. Kept as an honest empty object rather than a wider, speculative shape
 * so later guest-interface tasks (which give each overlay real content/callbacks) widen this type
 * exactly when they need to, instead of carrying unused fields now.
 */
export type OverlayBodyProps = Record<string, never>;

function ComingSoon(): JSX.Element {
  return <p>Coming in a later task</p>;
}

/**
 * The single shared lookup from `OverlayId` to the component that renders its body -- previously
 * duplicated as an identical `overlayBody` switch in both `App.tsx` and `PlayScreen.tsx`. All six
 * ids are still the same placeholder component for now (the overlay infrastructure ships fully
 * tested before any real overlay content exists); later guest-interface tasks replace individual
 * entries here with real components, and both hosts pick up the change automatically.
 *
 * Deliberately its own module (not folded into `registry.ts`): `registry.ts` stays React-free (it
 * is also consumed by a framework-free help-overlay content builder in a later task), while this
 * module is the React-specific component lookup both hosts share.
 */
export const OVERLAY_COMPONENTS: Readonly<Record<OverlayId, ComponentType<OverlayBodyProps>>> = {
  inventory: ComingSoon,
  'character-sheet': ComingSoon,
  'map-journal': ComingSoon,
  codex: ComingSoon,
  settings: ComingSoon,
  help: ComingSoon,
};
