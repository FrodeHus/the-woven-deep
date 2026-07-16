import type { JSX } from 'react';
import { NAV_LINKS, PLAY_ROUTE } from '../copy.js';

export function Nav(): JSX.Element {
  return (
    <nav className="wd-nav" aria-label="Primary">
      <div className="wd-wordmark">
        <span aria-hidden="true" className="wd-diamond" />
        <span className="wd-wordmark-text">The Woven Deep</span>
      </div>
      <div className="wd-nav-links">
        {NAV_LINKS.map((link) => (
          <a key={link.href} href={link.href} className="wd-nav-link">{link.label}</a>
        ))}
        <a href={PLAY_ROUTE} className="wd-nav-cta">Play Free</a>
      </div>
    </nav>
  );
}
