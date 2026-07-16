import type { JSX } from 'react';
import { LORE } from '../copy.js';

export function Lore(): JSX.Element {
  const [first, ...rest] = LORE.paragraphs;
  const dropCap = first!.slice(0, 1);
  const firstRest = first!.slice(1);
  const last = rest[rest.length - 1];
  const middle = rest.slice(0, -1);

  return (
    <section id="lore" className="wd-section wd-lore" aria-labelledby="lore-heading">
      <p data-reveal className="wd-eyebrow wd-centered">{LORE.eyebrow}</p>
      <h2 data-reveal id="lore-heading" className="wd-h2 wd-centered">{LORE.heading}</h2>
      <div data-reveal className="wd-lore-body">
        <p>
          <span aria-hidden="true" className="wd-drop-cap">{dropCap}</span>
          {firstRest}
        </p>
        {middle.map((paragraph) => (
          <p key={paragraph}>{paragraph}</p>
        ))}
        {last && <p className="wd-lore-final">{last}</p>}
      </div>
    </section>
  );
}
