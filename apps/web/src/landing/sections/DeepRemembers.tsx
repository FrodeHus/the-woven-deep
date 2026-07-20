import type { JSX } from 'react';
import { DEEP_REMEMBERS } from '../copy.js';

export function DeepRemembers(): JSX.Element {
  return (
    <section id="deep" className="wd-section wd-deep" aria-labelledby="deep-heading">
      <div data-reveal className="wd-section-intro">
        <p className="wd-eyebrow">{DEEP_REMEMBERS.eyebrow}</p>
        <h2 id="deep-heading" className="wd-h2">
          {DEEP_REMEMBERS.heading}
        </h2>
      </div>
      <div className="wd-pillars">
        {DEEP_REMEMBERS.pillars.map((pillar) => (
          <div data-reveal key={pillar.no} className="wd-pillar-card">
            <span className="wd-pillar-no">{pillar.no}</span>
            <h3 className="wd-card-title">{pillar.title}</h3>
            <p className="wd-card-body">{pillar.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
