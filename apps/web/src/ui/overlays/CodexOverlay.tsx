import { useState, type JSX, type ReactNode } from 'react';
import type { CompiledContentPack } from '@woven-deep/content';
import type { StoredHallRecord } from '@woven-deep/engine';
import {
  deriveCodexState,
  sortedClassEntries,
  type CodexCategory as CodexCategoryData,
  type CodexEntry,
  type Sightings,
} from '../../session/codex.js';
import type { SessionSnapshot } from '../../session/guest-session.js';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../components/tabs.js';
import { ListDetail, type ListDetailItem } from '../components/ListDetail.js';

const CATEGORY_ORDER: readonly CodexCategoryData['kind'][] = ['class', 'item', 'spell', 'monster'];

const CATEGORY_LABEL: Readonly<Record<CodexCategoryData['kind'], string>> = {
  class: 'Classes',
  item: 'Items',
  spell: 'Spells',
  monster: 'Monsters',
};

/** A locked class's `unlockHint`, zipped by index against the SAME `sortedClassEntries` order
 * `deriveCodexState` uses to build the class category -- `CodexEntry`'s undiscovered variant
 * deliberately carries no id to look this up by (spoiler-free), but `unlockHint` text is not
 * itself a spoiler: the Calling step of chargen already discloses it, unlocked or not. `null` for
 * every OTHER category, and for a discovered class (chargen shows no hint once a class is
 * playable). */
function unlockHintFor(
  pack: CompiledContentPack,
  category: CodexCategoryData,
  index: number,
): string | null {
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

function toListItem(entry: CodexEntry, index: number): ListDetailItem {
  return {
    id: String(index),
    glyph: entryGlyph(entry),
    label: entryLabel(entry),
    ...(entry.discovered ? { glyphColor: entry.color } : {}),
  };
}

function DetailPane({
  entry,
  unlockHint,
}: Readonly<{ entry: CodexEntry | undefined; unlockHint: string | null }>): ReactNode {
  if (!entry) return <p className="text-muted">Nothing selected.</p>;

  if (!entry.discovered) {
    return (
      <dl aria-label="Codex entry details" className="flex flex-col gap-1 text-sm">
        <dt className="text-muted">Name</dt>
        <dd>???</dd>
        <dt className="text-muted">Glyph</dt>
        <dd aria-hidden="true" className="font-mono">
          {entry.silhouetteGlyph}
        </dd>
        {unlockHint && (
          <>
            <dt className="text-muted">Unlock</dt>
            <dd>{unlockHint}</dd>
          </>
        )}
      </dl>
    );
  }

  return (
    <dl aria-label="Codex entry details" className="flex flex-col gap-1 text-sm">
      <dt className="text-muted">Name</dt>
      <dd>{entry.name}</dd>
      <dt className="text-muted">Glyph</dt>
      <dd style={{ color: entry.color }} aria-hidden="true" className="font-mono">
        {entry.glyph}
      </dd>
      {entry.description && (
        <>
          <dt className="text-muted">Description</dt>
          <dd>{entry.description}</dd>
        </>
      )}
      <dt className="text-muted">First seen</dt>
      <dd>{entry.firstSeenRun === null ? 'This run' : `Run #${entry.firstSeenRun}`}</dd>
    </dl>
  );
}

function CategoryPanel({
  category,
  pack,
  selectedIndex,
  onSelect,
}: Readonly<{
  category: CodexCategoryData;
  pack: CompiledContentPack;
  selectedIndex: number;
  onSelect: (index: number) => void;
}>): JSX.Element {
  const { entries } = category;
  return (
    <ListDetail
      listLabel={CATEGORY_LABEL[category.kind]}
      items={entries.map(toListItem)}
      selectedIndex={selectedIndex}
      onSelect={onSelect}
      renderDetail={(_item, index) => (
        <DetailPane entry={entries[index]} unlockHint={unlockHintFor(pack, category, index)} />
      )}
    />
  );
}

export interface CodexOverlayProps {
  readonly records: readonly StoredHallRecord[];
  readonly snapshot: SessionSnapshot | null;
  readonly sightings: Sightings;
  readonly pack: CompiledContentPack;
}

const EMPTY_SELECTION: Readonly<Record<CodexCategoryData['kind'], number>> = {
  class: 0,
  item: 0,
  spell: 0,
  monster: 0,
};

/**
 * The unlock codex: one category tab per content kind (classes/items/spells/monsters, the spec's
 * own order), each with a `ListDetail` list+detail pane. Reachable from the title screen too
 * (`snapshot` is `null` there -- the "active hero's class" discovery source is then simply
 * unavailable, exactly like every other active-run-only source with no active run). `records`,
 * `snapshot`, `sightings`, and `pack` all arrive as PROPS from `OverlayHost` -- `sightings` in
 * particular is a RESOLVED value there (falling back to the guest's persisted cross-run sighting
 * cache when there is no live session), so this component must never re-read it from session
 * context itself.
 *
 * Tab switching is the shared shadcn `Tabs` primitive (Base UI), the same convention
 * `MapJournalOverlay` established: `activateOnFocus` on `TabsList` so arrow keys switch the active
 * tab immediately. Within a panel, `ListDetail` owns list selection (ArrowUp/ArrowDown/Home/End).
 */
export function CodexOverlay({
  records,
  snapshot,
  sightings,
  pack,
}: Readonly<CodexOverlayProps>): JSX.Element {
  const state = deriveCodexState({ records, snapshot, sightings, pack });
  // One selection cursor per category, so switching tabs never loses (or cross-contaminates) the
  // guest's place in a different category's list -- mirrors each category panel's independent
  // `ListDetail` instance.
  const [selectedIndices, setSelectedIndices] = useState(EMPTY_SELECTION);

  return (
    <Tabs defaultValue="class" className="flex flex-col gap-3">
      <TabsList aria-label="Codex categories" activateOnFocus>
        {CATEGORY_ORDER.map((kind) => (
          <TabsTrigger key={kind} value={kind}>
            {CATEGORY_LABEL[kind]}
          </TabsTrigger>
        ))}
      </TabsList>
      {CATEGORY_ORDER.map((kind) => {
        const category = state.categories.find((candidate) => candidate.kind === kind)!;
        return (
          <TabsContent key={kind} value={kind}>
            <CategoryPanel
              category={category}
              pack={pack}
              selectedIndex={selectedIndices[kind]}
              onSelect={(index) => setSelectedIndices((prev) => ({ ...prev, [kind]: index }))}
            />
          </TabsContent>
        );
      })}
      <p className="text-sm text-muted">
        Session-only, like your Hall records — nothing here is confirmed by a server yet.
      </p>
    </Tabs>
  );
}
