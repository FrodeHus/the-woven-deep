import { useEffect, type RefObject } from 'react';

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
  );
}

/**
 * The hero's scroll parallax, rAF-throttled per the handoff: the cover poster translates
 * `translate3d(0, scrollY*0.1, 0)` and the Heart glow shifts `marginTop: scrollY*0.05`. Disabled
 * entirely under `prefers-reduced-motion` (no listener attached, so the elements simply keep
 * whatever static position the CSS gives them).
 */
export function useParallax(
  coverRef: RefObject<HTMLElement | null>,
  heartRef: RefObject<HTMLElement | null>,
): void {
  useEffect(() => {
    if (prefersReducedMotion()) return;

    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        const y = window.scrollY || 0;
        if (coverRef.current) coverRef.current.style.transform = `translate3d(0, ${y * 0.1}px, 0)`;
        if (heartRef.current) heartRef.current.style.marginTop = `${y * 0.05}px`;
        ticking = false;
      });
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, [coverRef, heartRef]);
}
