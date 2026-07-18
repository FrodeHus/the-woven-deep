import { useEffect, useRef, type JSX } from 'react';
import type { LogLine } from '../../session/event-log.js';
import type { PanelProps } from './types.js';

const TONE_CLASS: Record<LogLine['tone'], string> = {
  info: 'text-muted',
  combat: 'text-danger',
  warning: 'text-warn',
  system: 'text-muted',
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
          <p key={line.id} className={TONE_CLASS[line.tone]}>{line.text}</p>
        ))}
      </div>
    </div>
  );
}
