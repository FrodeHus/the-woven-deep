import type { JSX } from 'react';

export function ScrollCue(): JSX.Element {
  return (
    <div className="wd-scroll-cue" aria-hidden="true">
      <span>Descend</span>
      <span className="wd-scroll-cue-arrow">↓</span>
    </div>
  );
}
