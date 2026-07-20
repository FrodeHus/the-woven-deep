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

export function LogPanel({ snapshot }: PanelProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const { log } = snapshot;

  useEffect(() => {
    const node = containerRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [log]);

  return (
    <div className="flex h-full flex-col rounded-md border border-line bg-surface p-2">
      <div
        ref={containerRef}
        role="log"
        aria-live="polite"
        aria-label="Adventure log"
        className="max-h-40 overflow-y-auto font-mono text-xs leading-relaxed"
      >
        {log.map((line) => (
          <p key={line.id} className={cn(TONE_CLASS[line.tone], REINFORCEMENT_CLASS[line.tone])}>
            {line.text}
          </p>
        ))}
      </div>
    </div>
  );
}
