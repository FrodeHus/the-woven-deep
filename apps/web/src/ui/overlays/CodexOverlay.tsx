import { useEffect, useRef, useState, type JSX, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { CompiledContentPack } from '@woven-deep/content';
import type { StoredHallRecord } from '@woven-deep/engine';
import {
  deriveCodexState, sortedClassEntries, type CodexCategory as CodexCategoryData, type CodexEntry, type Sightings,
} from '../../session/codex.js';
import type { SessionSnapshot } from '../../session/guest-session.js';
import { useListNavigation } from '../screens/roving-focus.js';

const CATEGORY_ORDER: readonly CodexCategoryData['kind'][] = ['class', 'item', 'spell', 'monster'];

const CATEGORY_LABEL: Readonly<Record<CodexCategoryData['kind'], string>> = {
  class: 'Classes', item: 'Items', spell: 'Spells', monster: 'Monsters',
};

const TAB_ID: Readonly<Record<CodexCategoryData['kind'], string>> = {
  class: 'codex-tab-class', item: 'codex-tab-item', spell: 'codex-tab-spell', monster: 'codex-tab-monster',
};

const PANEL_ID: Readonly<Record<CodexCategoryData['kind'], string>> = {
  class: 'codex-panel-class', item: 'codex-panel-item', spell: 'codex-panel-spell', monster: 'codex-panel-monster',
};

/** A locked class's `unlockHint`, zipped by index against the SAME `sortedClassEntries` order
 * `deriveCodexState` used to build the class category -- `CodexEntry`'s undiscovered variant
 * deliberately carries no id to look this up by (spoiler-free), but `unlockHint` text is not
 * itself a spoiler: chargen already discloses it, unlocked or not (`ClassStep`,
 * `chargen-steps.tsx`). `null` for every OTHER category, and for a discovered class (chargen shows
 * no hint once a class is playable). */
function unlockHintFor(pack: CompiledContentPack, category: CodexCategoryData, index: number): string | null {
  if (category.kind !== 'class') return null;
  const entry = category.entries[index];
  if (!entry || entry.discovered) return null;
  return sortedClassEntries(pack)[index]?.unlockHint ?? null;
}

function entryLabel(entry: CodexEntry): string {
  return entry.discovered ? entry.name : '???';
}

function entryGlyph(entry: CodexEntry): string {
  return entry.discovered ? entry.glyph : entry.silhouetteGlyph;
}

function DetailPane({ entry, unlockHint }: Readonly<{ entry: CodexEntry | undefined; unlockHint: string | null }>): JSX.Element {
  if (!entry) return <p className="codex-detail placeholder">Nothing selected.</p>;

  if (!entry.discovered) {
    return (
      <dl className="codex-detail" aria-label="Codex entry details">
        <dt>Name</dt>
        <dd>???</dd>
        <dt>Glyph</dt>
        <dd aria-hidden="true">{entry.silhouetteGlyph}</dd>
        {unlockHint && (
          <>
            <dt>Unlock</dt>
            <dd>{unlockHint}</dd>
          </>
        )}
      </dl>
    );
  }

  return (
    <dl className="codex-detail" aria-label="Codex entry details">
      <dt>Name</dt>
      <dd>{entry.name}</dd>
      <dt>Glyph</dt>
      <dd style={{ color: entry.color }} aria-hidden="true">{entry.glyph}</dd>
      {entry.description && (
        <>
          <dt>Description</dt>
          <dd>{entry.description}</dd>
        </>
      )}
      <dt>First seen</dt>
      <dd>{entry.firstSeenRun === null ? 'This run' : `Run #${entry.firstSeenRun}`}</dd>
    </dl>
  );
}

function CategoryPanel({ category, pack, panelId, tabId }: Readonly<{
  category: CodexCategoryData; pack: CompiledContentPack; panelId: string; tabId: string;
}>): JSX.Element {
  const { entries } = category;
  const { selectedIndex, setSelectedIndex, registerItem, handleArrowKeys } = useListNavigation(entries.length);
  const selected = entries[selectedIndex];

  return (
    <div className="codex-category-panel" role="tabpanel" id={panelId} aria-labelledby={tabId} tabIndex={0}>
      {entries.length === 0
        ? <p className="placeholder">Nothing in this category yet.</p>
        : (
          <div className="codex-category-body">
            <ul role="listbox" aria-label={CATEGORY_LABEL[category.kind]} className="codex-entry-list" onKeyDown={handleArrowKeys}>
              {entries.map((entry, index) => (
                <li key={index} role="option" aria-selected={index === selectedIndex}>
                  <button
                    type="button"
                    ref={registerItem(index)}
                    className={index === selectedIndex ? 'codex-entry codex-entry--selected' : 'codex-entry'}
                    onClick={() => setSelectedIndex(index)}
                  >
                    <span aria-hidden="true">{entryGlyph(entry)}</span>
                    {' '}
                    {entryLabel(entry)}
                  </button>
                </li>
              ))}
            </ul>
            <DetailPane entry={selected} unlockHint={unlockHintFor(pack, category, selectedIndex)} />
          </div>
        )}
    </div>
  );
}

export interface CodexOverlayProps {
  readonly records: readonly StoredHallRecord[];
  readonly snapshot: SessionSnapshot | null;
  readonly sightings: Sightings;
  readonly pack: CompiledContentPack;
}

/**
 * The unlock codex: one category tab per content kind (classes/items/spells/monsters, the spec's
 * own order), each with a list+detail pane. Reachable from the title screen too (`snapshot` is
 * `null` there -- the "active hero's class" discovery source is then simply unavailable, exactly
 * like every other active-run-only source with no active run).
 *
 * Tab switching follows Task 7's completed `MapJournalOverlay` tablist convention exactly:
 * ArrowLeft/ArrowRight cycle the active tab (not the literal `Tab` key, which stays load-bearing
 * for `useDialogFocusTrap`'s own focus-order wrapping), with roving `tabIndex` and full
 * `tabpanel`/`aria-labelledby`/`aria-controls` linkage. Within a panel, ArrowUp/ArrowDown move the
 * list selection (`useListNavigation`, the same roving-focus hook `InventoryOverlay`/`KitStep` use).
 */
export function CodexOverlay({ records, snapshot, sightings, pack }: CodexOverlayProps): JSX.Element {
  const [tab, setTab] = useState<CodexCategoryData['kind']>('class');
  const state = deriveCodexState({ records, snapshot, sightings, pack });
  const category = state.categories.find((candidate) => candidate.kind === tab)!;

  const tabButtonRefs = useRef<Record<CodexCategoryData['kind'], HTMLButtonElement | null>>({
    class: null, item: null, spell: null, monster: null,
  });

  const handleTablistKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const currentIndex = CATEGORY_ORDER.indexOf(tab);
    const delta = event.key === 'ArrowRight' ? 1 : -1;
    const nextIndex = (currentIndex + delta + CATEGORY_ORDER.length) % CATEGORY_ORDER.length;
    const nextTab = CATEGORY_ORDER[nextIndex]!;
    setTab(nextTab);
    tabButtonRefs.current[nextTab]?.focus();
  };

  return (
    <div className="codex-overlay">
      <div
        role="tablist"
        aria-label="Codex categories"
        className="codex-tablist"
        tabIndex={-1}
        onKeyDown={handleTablistKeyDown}
      >
        {CATEGORY_ORDER.map((candidate) => (
          <button
            key={candidate}
            ref={(element) => { tabButtonRefs.current[candidate] = element; }}
            type="button"
            role="tab"
            id={TAB_ID[candidate]}
            aria-selected={candidate === tab}
            aria-controls={PANEL_ID[candidate]}
            tabIndex={candidate === tab ? 0 : -1}
            className={candidate === tab ? 'codex-tab codex-tab--active' : 'codex-tab'}
            onClick={() => setTab(candidate)}
          >
            {CATEGORY_LABEL[candidate]}
          </button>
        ))}
      </div>
      <CategoryPanel category={category} pack={pack} panelId={PANEL_ID[tab]} tabId={TAB_ID[tab]} />
      <p className="codex-footer">Session-only, like your Hall records — nothing here is confirmed by a server yet.</p>
    </div>
  );
}
