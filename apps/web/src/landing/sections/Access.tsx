import type { JSX } from 'react';
import { ACCESS, PLAY_ROUTE, REGISTRATION_COMING_SOON_HREF } from '../copy.js';

export function Access(): JSX.Element {
  return (
    <section id="access" className="wd-section wd-access" aria-labelledby="access-heading">
      <div data-reveal className="wd-section-intro">
        <p className="wd-eyebrow">{ACCESS.eyebrow}</p>
        <h2 id="access-heading" className="wd-h2">
          {ACCESS.heading}
        </h2>
        <p className="wd-access-supporting">{ACCESS.supporting}</p>
      </div>
      <div className="wd-access-cards">
        <div data-reveal className="wd-access-card wd-access-guest">
          <p className="wd-card-label">{ACCESS.guest.label}</p>
          <h3 className="wd-card-title">{ACCESS.guest.title}</h3>
          <p className="wd-access-card-body">{ACCESS.guest.body}</p>
          <ul className="wd-benefit-list">
            {ACCESS.guest.positives.map((text) => (
              <li key={text}>
                <span aria-hidden="true" className="wd-mark wd-mark-positive">
                  ›
                </span>
                {text}
              </li>
            ))}
            {ACCESS.guest.limits.map((text) => (
              <li key={text} className="wd-benefit-limit">
                <span aria-hidden="true" className="wd-mark wd-mark-limit">
                  ✕
                </span>
                {text}
              </li>
            ))}
          </ul>
          <a href={PLAY_ROUTE} className="wd-cta-outline wd-cta-block">
            {ACCESS.guest.cta}
          </a>
        </div>
        <div data-reveal className="wd-access-card wd-access-member">
          <div className="wd-ribbon">{ACCESS.member.ribbon}</div>
          <p className="wd-card-label wd-card-label-warm">{ACCESS.member.label}</p>
          <h3 className="wd-card-title">{ACCESS.member.title}</h3>
          <p className="wd-access-card-body wd-access-card-body-warm">{ACCESS.member.body}</p>
          <ul className="wd-benefit-list">
            {ACCESS.member.benefits.map((text) => (
              <li key={text}>
                <span aria-hidden="true" className="wd-mark wd-mark-star">
                  ✦
                </span>
                {text}
              </li>
            ))}
          </ul>
          {/* Milestone 6 (registered accounts) doesn't exist yet: point at a "coming soon" anchor
           * rather than a route to a page that isn't built. */}
          <a href={REGISTRATION_COMING_SOON_HREF} className="wd-cta-primary wd-cta-block">
            {ACCESS.member.cta}
          </a>
        </div>
      </div>
    </section>
  );
}
