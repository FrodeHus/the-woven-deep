import { useEffect, useMemo, useState, type JSX, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { CompletionType } from '@woven-deep/content';
import { compareHallRecords, type OpaqueId, type RunRecordRepository, type StoredHallRecord } from '@woven-deep/engine';
import { useListNavigation } from './roving-focus.js';

export interface HallScreenProps {
  readonly repository: RunRecordRepository;
  readonly onBack: () => void;
}

type OutcomeFilter = 'all' | CompletionType;
type ClassFilter = 'all' | string;

const OUTCOME_ORDER: readonly CompletionType[] = ['broke-cycle', 'became-heart', 'refused', 'died'];

const OUTCOME_LABEL: Readonly<Record<CompletionType, string>> = {
  'broke-cycle': 'Broke the cycle',
  'became-heart': 'Became the Heart',
  refused: 'Refused the Deep',
  died: 'Died',
};

const SCORE_LINE_LABEL: Readonly<Record<string, string>> = {
  depth: 'depth',
  'boss-defeats': 'boss-defeats',
  threat: 'threat',
  discoveries: 'discoveries',
  'completion-bonus': 'completion-bonus',
  'turn-efficiency': 'turn-efficiency',
};

function matchesFilters(record: StoredHallRecord, outcome: OutcomeFilter, classTag: ClassFilter): boolean {
  if (outcome !== 'all' && record.completionType !== outcome) return false;
  if (classTag !== 'all' && !record.classTags.includes(classTag)) return false;
  return true;
}

/**
 * The Hall of Records: every session-scoped `StoredHallRecord` from `repository.records()`,
 * sorted by the engine's `compareHallRecords` (completion tier dominates, then score, then record
 * ID as a final tiebreak — see `score-run.ts`). Filtering (outcome/class) is pure local component
 * state over the already-sorted list; nothing here mutates the repository. Row expansion reveals
 * the itemized `ScoreBreakdown` the engine attached to that record, exactly as scored — this
 * screen never recomputes a score.
 *
 * Like `ConclusionScreen`, the Hall is explicitly marked unverified/session-only: this is the
 * guest client, with no server-side confirmation of anything shown here.
 */
export function HallScreen({ repository, onBack }: HallScreenProps): JSX.Element {
  const records = useMemo(() => [...repository.records()].sort(compareHallRecords), [repository]);
  const [outcomeFilter, setOutcomeFilter] = useState<OutcomeFilter>('all');
  const [classFilter, setClassFilter] = useState<ClassFilter>('all');
  const [expandedRecordId, setExpandedRecordId] = useState<OpaqueId | null>(null);

  const availableClassTags = useMemo(
    () => [...new Set(records.flatMap((record) => record.classTags))].sort(),
    [records],
  );

  const filtered = records.filter((record) => matchesFilters(record, outcomeFilter, classFilter));

  const { selectedIndex, registerItem, handleArrowKeys } = useListNavigation(filtered.length);

  // A document-level listener (rather than an onKeyDown on the section) so Escape returns to
  // `returnTo` even when the Hall is empty and no row has ever taken focus.
  useEffect(() => {
    function handleDocumentKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') onBack();
    }
    document.addEventListener('keydown', handleDocumentKeyDown);
    return () => document.removeEventListener('keydown', handleDocumentKeyDown);
  }, [onBack]);

  function toggleExpanded(recordId: OpaqueId): void {
    setExpandedRecordId((current) => (current === recordId ? null : recordId));
  }

  function handleRowKeyDown(event: ReactKeyboardEvent, recordId: OpaqueId): void {
    if (handleArrowKeys(event)) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      toggleExpanded(recordId);
    }
  }

  return (
    <section aria-label="Hall of Records" className="hall-screen">
      <p className="eyebrow">The Woven Deep</p>
      <h1 className="framed-title">Hall of Records</h1>
      <p role="note" className="hall-provenance">
        Unverified · this session only — nothing here is confirmed by a server yet.
      </p>

      <div className="hall-filters">
        <label className="hall-filter">
          Outcome
          <select
            aria-label="Outcome filter"
            value={outcomeFilter}
            onChange={(event) => setOutcomeFilter(event.target.value as OutcomeFilter)}
          >
            <option value="all">All outcomes</option>
            {OUTCOME_ORDER.map((outcome) => (
              <option key={outcome} value={outcome}>{OUTCOME_LABEL[outcome]}</option>
            ))}
          </select>
        </label>
        <label className="hall-filter">
          Class
          <select
            aria-label="Class filter"
            value={classFilter}
            onChange={(event) => setClassFilter(event.target.value)}
          >
            <option value="all">All classes</option>
            {availableClassTags.map((tag) => (
              <option key={tag} value={tag}>{tag}</option>
            ))}
          </select>
        </label>
      </div>

      {records.length === 0 ? (
        <p role="status">No runs have been recorded yet — the Hall awaits its first legend.</p>
      ) : filtered.length === 0 ? (
        <p role="status">No records match the current filters.</p>
      ) : (
        <ul role="listbox" aria-label="Hall records" className="hall-records">
          {filtered.map((record, index) => {
            const expanded = expandedRecordId === record.recordId;
            return (
              <li key={record.recordId}>
                <div
                  role="option"
                  tabIndex={-1}
                  aria-selected={index === selectedIndex}
                  aria-expanded={expanded}
                  ref={registerItem(index)}
                  className={index === selectedIndex ? 'hall-row hall-row--focused' : 'hall-row'}
                  onKeyDown={(event) => handleRowKeyDown(event, record.recordId)}
                  onClick={() => toggleExpanded(record.recordId)}
                >
                  <span className="hall-glyph">{record.enrichment.portraitGlyph}</span>
                  <span className="hall-name">{record.heroName}</span>
                  <span className="hall-classes">{record.classTags.join(', ')}</span>
                  <span className="hall-depth">Depth {record.deepestDepth}</span>
                  <span className="hall-score">{record.score.total}</span>
                  <span className="hall-run">{record.enrichment.achievedAt}</span>
                </div>
                {expanded && (
                  <table aria-label={`${record.heroName} score breakdown`} className="hall-breakdown">
                    <tbody>
                      {record.score.lines.map((line) => (
                        <tr key={line.lineId}>
                          <td>{SCORE_LINE_LABEL[line.lineId] ?? line.lineId}</td>
                          <td>{line.amount}</td>
                        </tr>
                      ))}
                      <tr>
                        <td>Total</td>
                        <td>{record.score.total}</td>
                      </tr>
                    </tbody>
                  </table>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <button type="button" onClick={onBack}>Back</button>
    </section>
  );
}
