import type { JSX } from 'react';
import type { Settings } from '../session/settings.js';
import { effectiveReducedMotion, ScreenFade } from './ScreenFade.js';

export interface RootStylingProps {
  readonly settings: Settings;
  readonly fadeToken: number;
  readonly children: JSX.Element;
}

/**
 * `fontScale` as an inline `calc(1rem * scale)` on the app root, and `reducedMotion` as at most one
 * root class -- the three-way contract (see `styles.css`'s comment beside `.motion-full`): "system"
 * applies neither class (the `@media (prefers-reduced-motion: reduce)` query alone decides), "on"
 * applies `.motion-reduced` (forces animations off regardless of the OS setting), "off" applies
 * `.motion-full` (forces animations back on regardless of the OS setting -- the one case a media
 * query alone cannot serve, since it never sees the in-app setting). The SAME three-way value,
 * resolved to a plain boolean via `effectiveReducedMotion`, gates `ScreenFade` -- reduced motion
 * must render NO fade element at all, which only a JS-side decision can express (a CSS class alone
 * cannot suppress an element's existence).
 */
export function RootStyling({ settings, fadeToken, children }: RootStylingProps): JSX.Element {
  const motionClass = settings.reducedMotion === 'on' ? ' motion-reduced'
    : settings.reducedMotion === 'off' ? ' motion-full' : '';
  const themeClass = settings.theme === 'high-contrast' ? ' theme-high-contrast' : '';
  return (
    <div className={`guest-app-root${motionClass}${themeClass}`} style={{ fontSize: `calc(1rem * ${settings.fontScale})` }}>
      <ScreenFade transitionKey={fadeToken} reducedMotion={effectiveReducedMotion(settings.reducedMotion)}>
        {children}
      </ScreenFade>
    </div>
  );
}
