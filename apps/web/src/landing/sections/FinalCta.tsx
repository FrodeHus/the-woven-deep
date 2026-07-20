import type { JSX } from 'react';
import { FINAL_CTA, PLAY_ROUTE, TAGLINE } from '../copy.js';

export function FinalCta(): JSX.Element {
  return (
    <section id="play" className="wd-section wd-final-cta" aria-labelledby="final-cta-heading">
      <div data-reveal className="wd-final-cta-panel">
        <p className="wd-eyebrow">{FINAL_CTA.eyebrow}</p>
        <h2 id="final-cta-heading" className="wd-final-cta-heading">
          {FINAL_CTA.heading[0]}
          <br />
          {FINAL_CTA.heading[1]}
        </h2>
        <p className="wd-final-cta-supporting">{FINAL_CTA.supporting}</p>
        <div className="wd-final-cta-ctas">
          <a href={PLAY_ROUTE} className="wd-cta-primary wd-cta-large">
            {FINAL_CTA.primaryCta}
          </a>
          <a href="#access" className="wd-cta-text-link">
            {FINAL_CTA.secondaryCta}
          </a>
        </div>
      </div>
      <footer className="wd-footer">
        <div className="wd-footer-mark">
          <span aria-hidden="true" className="wd-diamond wd-diamond-dim" />
          <span className="wd-footer-wordmark">The Woven Deep</span>
        </div>
        <span className="wd-footer-tagline">{TAGLINE}</span>
      </footer>
    </section>
  );
}
