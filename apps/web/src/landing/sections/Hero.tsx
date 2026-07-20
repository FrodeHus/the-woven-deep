import { type JSX, type RefObject } from 'react';
import { HERO, PLAY_ROUTE, TAGLINE } from '../copy.js';

export interface HeroProps {
  readonly coverRef: RefObject<HTMLImageElement | null>;
  readonly heartRef: RefObject<HTMLDivElement | null>;
}

export function Hero({ coverRef, heartRef }: HeroProps): JSX.Element {
  return (
    <header className="wd-hero">
      <div className="wd-hero-copy">
        <p className="wd-eyebrow">{HERO.eyebrow}</p>
        <h1 className="wd-h1">
          Few return
          <br />
          from the Deep.
          <br />
          <span className="wd-h1-accent">None are forgotten.</span>
        </h1>
        <p className="wd-lead">
          {HERO.lead.before}
          <em className="wd-heart-em">{HERO.lead.emphasis}</em>
          {HERO.lead.after}
        </p>
        <p className="wd-hero-tagline">{HERO.italicTagline}</p>
        <div className="wd-hero-ctas">
          <a href={PLAY_ROUTE} className="wd-cta-primary">
            Descend Now <span aria-hidden="true">▾</span>
          </a>
          <a href={PLAY_ROUTE} className="wd-cta-outline">
            Enter as guest
          </a>
        </div>
        <p className="wd-micro">{TAGLINE}</p>
      </div>
      <div className="wd-hero-art">
        <div ref={heartRef} aria-hidden="true" className="wd-heart-glow" />
        <div className="wd-poster-frame">
          <img
            ref={coverRef}
            src="/images/woven-deep-cover.png"
            alt={HERO.coverAlt}
            className="wd-poster-img"
          />
          <div aria-hidden="true" className="wd-poster-vignette" />
        </div>
      </div>
    </header>
  );
}
