import { useEffect, useRef, type JSX } from 'react';
import type { LogLine } from '../../session/event-log.js';
import { cn } from '../lib/cn.js';
import type { PanelProps } from './types.js';

const TONE_CLASS: Record<LogLine['tone'], string> = {
  info: 'text-muted',
  combat: 'text-danger',
  warning: 'text-warn',
  system: 'text-muted',
};

/** Colorblind reinforcement classes (`styles.css`'s `.log-line--*::before` rules): a silent leading
 * glyph for each colored tone, so severity is never carried by `TONE_CLASS`'s text color alone.
 * `info` gets no glyph -- it is the neutral/default tone. */
const REINFORCEMENT_CLASS: Partial<Record<LogLine['tone'], string>> = {
  combat: 'log-line--combat',
  warning: 'log-line--warning',
  system: 'log-line--system',
};

/** The floating log shows only the most recent handful of lines -- older history lives in the
 * message journal. */
const VISIBLE_LINES = 5;

export function LogPanel({ snapshot }: PanelProps): JSX.Element | null {
  const containerRef = useRef<HTMLDivElement>(null);
  const { log } = snapshot;
  const recent = log.slice(-VISIBLE_LINES);

  useEffect(() => {
    const node = containerRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [log]);

  // With no lines yet, render nothing rather than an empty floating box over the playfield.
  if (recent.length === 0) return null;

  return (
    <div className="pointer-events-auto absolute bottom-3 left-3 z-10 w-80 max-w-[calc(100vw-1.5rem)] rounded-md border border-line bg-deep/70 p-2 backdrop-blur-sm">
      <div
        ref={containerRef}
        role="log"
        aria-live="polite"
        aria-label="Adventure log"
        className="max-h-32 overflow-y-auto font-mono text-xs leading-relaxed"
      >
        {recent.map((line) => (
          <p key={line.id} className={cn(TONE_CLASS[line.tone], REINFORCEMENT_CLASS[line.tone])}>
            {line.text}
          </p>
        ))}
      </div>
    </div>
  );
}
