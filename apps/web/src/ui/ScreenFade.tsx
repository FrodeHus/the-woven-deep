import { useEffect, useRef, useState, type JSX, type ReactNode } from 'react';

/** Total fade-through-dark duration: ~220ms fading to `--ground`, ~220ms fading back out --
 * matches the `screen-fade` keyframes in `styles.css` (kept in sync by
 * `test/screen-fade.test.tsx`'s styles-contract-style assertion, rather than a copied literal). */
export const SCREEN_FADE_MS = 440;

export type ReducedMotionSetting = 'system' | 'on' | 'off';

/**
 * Resolves the three-way reduced-motion contract (see `styles.css`'s comment beside
 * `.motion-full`, and `App.tsx`'s `withRootStyling`) to a single effective boolean: "system" reads
 * the OS-level media query, "on" forces reduced motion regardless of the OS setting, "off" forces
 * full motion regardless of the OS setting. `ScreenFade` needs this as a JS-side value, not just a
 * CSS class -- reduced motion must render NO fade element at all (an instant swap, not a
 * zero-duration animation), which only a JS-side decision before mounting the element can express.
 */
export function effectiveReducedMotion(setting: ReducedMotionSetting): boolean {
  if (setting === 'on') return true;
  if (setting === 'off') return false;
  return (
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
  );
}

export interface ScreenFadeProps {
  /** Changes exactly when a fade should play. Callers own the transition policy (which
   * screen/floor changes count) -- `ScreenFade` itself is purely mechanical: it plays a fade
   * whenever this value differs from the previous render's, and never on first mount (mounting a
   * screen for the first time is not a transition). */
  readonly transitionKey: string | number;
  /** The effective (already-resolved) reduced-motion value -- see `effectiveReducedMotion`. */
  readonly reducedMotion: boolean;
  readonly children: ReactNode;
}

/**
 * A short fade-through-dark wrapper for screen/floor transitions (title->play, chargen->play,
 * descend/ascend within play, play->conclusion). Purely visual: the overlay is `aria-hidden` and
 * `pointer-events: none`, so it never blocks input -- `children` already render the NEW state the
 * instant `transitionKey` changes (screen switching itself stays the instant conditional-return it
 * always was), and the overlay merely cloaks that swap for `SCREEN_FADE_MS`.
 *
 * Under reduced motion (the effective three-way value the caller resolves via
 * `effectiveReducedMotion` and passes in), no fade element is ever created at all -- the swap is
 * instant, matching the design's "applies the new state immediately" rather than degrading to a
 * zero-duration animation.
 *
 * Cleanup is the same dual pattern as `EffectsLayer`'s transient effects: `onAnimationEnd` for the
 * normal case, plus a timeout backup, because a reduced-motion `animation: none` (the CSS-side
 * belt-and-suspenders declared in all four motion blocks) never fires `animationend`.
 */
export function ScreenFade({
  transitionKey,
  reducedMotion,
  children,
}: ScreenFadeProps): JSX.Element {
  const previousKeyRef = useRef(transitionKey);
  const [fading, setFading] = useState(false);

  useEffect(() => {
    if (previousKeyRef.current === transitionKey) return undefined;
    previousKeyRef.current = transitionKey;
    if (reducedMotion) return undefined;
    setFading(true);
    const timeout = setTimeout(() => setFading(false), SCREEN_FADE_MS);
    return () => clearTimeout(timeout);
  }, [transitionKey, reducedMotion]);

  return (
    <>
      {children}
      {fading && (
        <div aria-hidden="true" className="screen-fade" onAnimationEnd={() => setFading(false)} />
      )}
    </>
  );
}
