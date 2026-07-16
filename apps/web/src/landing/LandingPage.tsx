import { useRef, type JSX } from 'react';
import { EmberCanvas } from './EmberCanvas.js';
import { useParallax } from './useParallax.js';
import { useScrollReveal } from './useScrollReveal.js';
import { Access } from './sections/Access.js';
import { DeepRemembers } from './sections/DeepRemembers.js';
import { Faq } from './sections/Faq.js';
import { Features } from './sections/Features.js';
import { FinalCta } from './sections/FinalCta.js';
import { Hero } from './sections/Hero.js';
import { Lore } from './sections/Lore.js';
import { Nav } from './sections/Nav.js';
import { ScrollCue } from './sections/ScrollCue.js';
import './landing.css';

/**
 * The marketing landing page, recreated from the design handoff at
 * `docs/design/landing-handoff/README.md`. Tokens, layout, and interactions (scroll reveal,
 * parallax, ember particle system, FAQ accordion) follow the handoff; copy was rewritten in a
 * humanizing pass (see `copy.ts`'s header comment) to strip AI-typical constructions while
 * keeping the epic register.
 *
 * Two fixed decorative layers (ambient gradient + ember canvas) sit behind all content, per the
 * handoff's z-index stack. Content sits above them; `data-reveal` elements start hidden and are
 * revealed by `useScrollReveal`.
 */
export function LandingPage(): JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null);
  const coverRef = useRef<HTMLImageElement>(null);
  const heartRef = useRef<HTMLDivElement>(null);

  useScrollReveal(rootRef);
  useParallax(coverRef, heartRef);

  return (
    <div ref={rootRef} className="wd-root">
      <div aria-hidden="true" className="wd-ambient-glow" />
      <EmberCanvas />
      <Nav />
      <Hero coverRef={coverRef} heartRef={heartRef} />
      <ScrollCue />
      <Lore />
      <DeepRemembers />
      <Access />
      <Features />
      <Faq />
      <FinalCta />
    </div>
  );
}
