import type { JSX } from 'react';
import type { CompiledContentPack } from '@woven-deep/content';
import type { RunConclusionProjection } from '@woven-deep/engine';
import type { LogLine } from '../../session/event-log.js';
import { useListNavigation } from './roving-focus.js';

export interface ConclusionScreenProps {
  readonly projection: RunConclusionProjection;
  readonly pack: CompiledContentPack;
  /** The tail of the adventure log at the moment of conclusion — the caller decides how much of
   * it to keep; this screen only ever renders what it's given. */
  readonly logTail: readonly LogLine[];
  readonly onHall: () => void;
  readonly onNewHero: () => void;
  readonly onTitle: () => void;
}

const SCORE_LINE_LABEL: Readonly<Record<string, string>> = {
  depth: 'Depth reached',
  'boss-defeats': 'Bosses defeated',
  threat: 'Threat defeated',
  discoveries: 'Discoveries revealed',
  'completion-bonus': 'Completion bonus',
  'turn-efficiency': 'Turn efficiency',
};

const COMPLETION_HEADLINE: Readonly<Record<RunConclusionProjection['completionType'], string>> = {
  died: 'You have fallen.',
  'became-heart': 'You have become the Heart.',
  'broke-cycle': 'You have broken the cycle.',
  refused: 'You have refused the Deep.',
};

/** Resolves a killer's display name from its content ID: monsters carry a `name` field; a `null`
 * killer (starvation, environmental causes) has no named culprit. */
function killerName(pack: CompiledContentPack, killerContentId: string | null): string | null {
  if (killerContentId === null) return null;
  const entry = pack.entries.find((candidate) => candidate.id === killerContentId);
  return entry && 'name' in entry ? (entry as { name: string }).name : killerContentId;
}

/**
 * The death-flow's ceremony screen: what happened, the last moments leading up to it, the
 * itemized score, any heirloom carried forward, and achievements earned this life. Its standing
 * is explicitly marked unverified/session-only — this is the guest client, with no server-side
 * confirmation of anything shown here (that lands with account-bound persistence in a later
 * milestone). Three keyboard-first actions close the loop: return to the Hall, start a new hero,
 * or head back to the title.
 */
export function ConclusionScreen({
  projection, pack, logTail, onHall, onNewHero, onTitle,
}: ConclusionScreenProps): JSX.Element {
  const { cause, score, heirloom, achievements, completionType } = projection;
  const killer = killerName(pack, cause.killerContentId);

  const options: readonly { readonly key: string; readonly label: string; readonly onSelect: () => void }[] = [
    { key: 'hall', label: 'Hall of Records', onSelect: onHall },
    { key: 'new-hero', label: 'New Hero', onSelect: onNewHero },
    { key: 'title', label: 'Title', onSelect: onTitle },
  ];
  const { selectedIndex, registerItem, handleArrowKeys } = useListNavigation(options.length);

  return (
    <section aria-label="Conclusion" className="conclusion-screen">
      <p className="eyebrow">The Woven Deep</p>
      <h1>{COMPLETION_HEADLINE[completionType]}</h1>
      <p className="conclusion-cause">
        {killer ? `Slain by ${killer}` : 'Claimed by the depths'} at depth {cause.depth}, turn {cause.turn}.
      </p>

      <section aria-label="Last moments" className="conclusion-recap">
        <h2>Last moments</h2>
        <ol className="conclusion-log-tail">
          {logTail.map((line) => (
            <li key={line.id} className={`log-line log-line--${line.tone}`}>{line.text}</li>
          ))}
        </ol>
      </section>

      {score && (
        <section aria-label="Score" className="conclusion-score">
          <h2>Score</h2>
          <table aria-label="Score">
            <tbody>
              {score.lines.map((line) => (
                <tr key={line.lineId}>
                  <td>{SCORE_LINE_LABEL[line.lineId] ?? line.lineId}</td>
                  <td>{line.amount}</td>
                </tr>
              ))}
              <tr>
                <td>Total</td>
                <td>{score.total}</td>
              </tr>
            </tbody>
          </table>
        </section>
      )}

      {heirloom && (
        <section aria-label="Heirloom" className="conclusion-heirloom">
          <h2>Heirloom</h2>
          <p>{heirloom.displayName}</p>
        </section>
      )}

      {achievements.length > 0 && (
        <section aria-label="Achievements" className="conclusion-achievements">
          <h2>Achievements</h2>
          <ul>
            {achievements.map((achievement) => (
              <li key={achievement.achievementId}>{achievement.name}</li>
            ))}
          </ul>
        </section>
      )}

      <p role="note" className="conclusion-provenance">
        Unverified · this session only — nothing here is confirmed by a server yet.
      </p>

      <div role="listbox" aria-label="Conclusion menu" className="conclusion-menu" onKeyDown={handleArrowKeys}>
        {options.map((option, index) => (
          <button
            key={option.key}
            type="button"
            role="option"
            aria-selected={index === selectedIndex}
            ref={registerItem(index)}
            className={index === selectedIndex ? 'conclusion-option conclusion-option--focused' : 'conclusion-option'}
            onClick={option.onSelect}
          >
            {option.label}
          </button>
        ))}
      </div>
    </section>
  );
}
