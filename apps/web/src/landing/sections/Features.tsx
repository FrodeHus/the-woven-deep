import type { JSX } from 'react';
import { FEATURES } from '../copy.js';

export function Features(): JSX.Element {
  return (
    <section id="features" className="wd-section wd-features" aria-labelledby="features-heading">
      <div data-reveal className="wd-section-intro">
        <p className="wd-eyebrow">{FEATURES.eyebrow}</p>
        <h2 id="features-heading" className="wd-h2">
          {FEATURES.heading}
        </h2>
      </div>
      <div className="wd-feature-grid">
        {FEATURES.items.map((item) => (
          <div data-reveal key={item.title} className="wd-feature-card">
            <div aria-hidden="true" className="wd-feature-glyph">
              {item.icon}
            </div>
            <h3 className="wd-card-title">{item.title}</h3>
            <p className="wd-card-body">{item.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
