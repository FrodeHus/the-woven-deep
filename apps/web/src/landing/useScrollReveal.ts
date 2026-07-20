import { useEffect, type RefObject } from 'react';

/** Matches the handoff's reveal timing: give elements a chance to reveal on load/scroll/resize,
 * but never trust that alone — a hard fallback guarantees content can't stay hidden forever
 * (e.g. if a scroll/resize event never fires after mount). */
const HARD_FALLBACK_MS = 1600;
const VIEWPORT_ENTRY_FRACTION = 0.92;

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
  );
}

/**
 * Scroll-reveal for every `[data-reveal]` element inside `containerRef`: each starts hidden
 * (`landing.css` sets the initial `opacity:0; translateY(...)`) and gains `.is-revealed` once it
 * nears the viewport, on load, on scroll, and on resize. Self-healing per the handoff: a
 * `~1.6s` hard fallback reveals anything still hidden, so a missed event can never leave content
 * permanently invisible. Under `prefers-reduced-motion`, every element reveals immediately and
 * no listeners are attached (the CSS reduced-motion block also drops the transition, so this is
 * belt-and-suspenders).
 */
export function useScrollReveal(containerRef: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let items = Array.from(container.querySelectorAll<HTMLElement>('[data-reveal]'));

    if (prefersReducedMotion()) {
      items.forEach((el) => el.classList.add('is-revealed'));
      return;
    }

    const revealInView = () => {
      const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
      items = items.filter((el) => {
        const rect = el.getBoundingClientRect();
        const inView = rect.top < viewportHeight * VIEWPORT_ENTRY_FRACTION && rect.bottom > 0;
        if (inView) el.classList.add('is-revealed');
        return !inView;
      });
    };

    const raf = requestAnimationFrame(revealInView);
    const fallback = setTimeout(() => {
      items.forEach((el) => el.classList.add('is-revealed'));
      items = [];
    }, HARD_FALLBACK_MS);

    const onScrollOrResize = () => revealInView();
    window.addEventListener('scroll', onScrollOrResize, { passive: true });
    window.addEventListener('resize', onScrollOrResize, { passive: true });

    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(fallback);
      window.removeEventListener('scroll', onScrollOrResize);
      window.removeEventListener('resize', onScrollOrResize);
    };
  }, [containerRef]);
}
