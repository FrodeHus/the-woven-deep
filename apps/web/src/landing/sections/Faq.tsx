import { useState, type JSX } from 'react';
import { FAQS } from '../copy.js';

/** Single-open accordion: item 0 open by default, toggling the open item closes it, opening a
 * different one closes whichever was open. Real `<button>`s with `aria-expanded`, per the
 * handoff's accessibility notes. */
export function Faq(): JSX.Element {
  const [openIndex, setOpenIndex] = useState(0);

  return (
    <section className="wd-section wd-faq" aria-labelledby="faq-heading">
      <h2 id="faq-heading" data-reveal className="wd-h2 wd-faq-heading">
        Before you descend
      </h2>
      <div className="wd-faq-list">
        {FAQS.map((item, index) => {
          const open = openIndex === index;
          const panelId = `faq-panel-${index}`;
          const buttonId = `faq-button-${index}`;
          return (
            <div data-reveal key={item.q} className="wd-faq-item">
              <button
                type="button"
                id={buttonId}
                aria-expanded={open}
                aria-controls={panelId}
                className="wd-faq-toggle"
                onClick={() => setOpenIndex((current) => (current === index ? -1 : index))}
              >
                <span>{item.q}</span>
                <span aria-hidden="true" className="wd-faq-sign">
                  {open ? '−' : '+'}
                </span>
              </button>
              {open && (
                <p id={panelId} role="region" aria-labelledby={buttonId} className="wd-faq-answer">
                  {item.a}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
