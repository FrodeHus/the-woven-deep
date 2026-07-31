import type { ArtifactDefinition, CompiledContentPack, CompletionType } from '@woven-deep/content';
import type {
  ArtifactLedger,
  ArtifactStint,
  ArtifactStintOutcome,
  StoredHallRecord,
} from '@woven-deep/engine';
import { itemById, itemEntries, spellEntries } from './pack-queries.js';

/**
 * Everything the client knows about artifacts, in one framework-free module: whether an item IS an
 * artifact (the compiled pack's `artifact` block is the only authority -- the projection never
 * flags one), and how a circulation history reads as prose.
 *
 * Provenance lives in the records repository's `artifactLedger()`, keyed by the artifact's content
 * id, and is joined to the item CLIENT-SIDE (spec amendment recorded in the plan: the engine never
 * holds the ledger, so `ItemView` cannot carry stints without leaking repository state into a
 * projection).
 */

/** The `artifact` block of `contentId`'s item entry, or `undefined` when the id names no item, an
 * unidentified item (no `contentId` at all), or an ordinary one. */
export function artifactOf(
  pack: CompiledContentPack,
  contentId: string | undefined,
): ArtifactDefinition | undefined {
  if (contentId === undefined) return undefined;
  return itemById(pack, contentId)?.artifact ?? undefined;
}

export function isArtifact(pack: CompiledContentPack, contentId: string | undefined): boolean {
  return artifactOf(pack, contentId) !== undefined;
}

/**
 * Whether this item's light burns without fuel. The gate is the pack's `artifact.light.fuelless`
 * flag and never the instance's `fuel` field: a fuelless instance is created holding
 * `fuel: fuelCapacity` (it simply never spends it), so `fuel === null` would hide nothing.
 */
export function isFuellessLight(pack: CompiledContentPack, contentId: string | undefined): boolean {
  return artifactOf(pack, contentId)?.light?.fuelless === true;
}

export interface SignatureView {
  readonly spellId: string;
  /** The spell's own display name, or its id when the pack somehow names no such spell (the
   * compiler already rejects an unresolvable `signature.spellId`, so this is belt-and-braces). */
  readonly name: string;
  /** The signature's full charge track -- the ceiling a floor recharge tops the instance up to. */
  readonly maximumCharges: number;
  readonly rechargePerFloor: number;
}

/**
 * The signature ability `contentId`'s artifact casts, or `undefined` when the item is not an
 * artifact, is unidentified (no `contentId`), or is a signature-less artifact like Maria's Grace --
 * which is exactly the set of items that must show no cast affordance.
 */
export function artifactSignature(
  pack: CompiledContentPack,
  contentId: string | undefined,
): SignatureView | undefined {
  const signature = artifactOf(pack, contentId)?.signature;
  if (!signature) return undefined;
  const spell = spellEntries(pack).find((entry) => entry.id === signature.spellId);
  return {
    spellId: signature.spellId,
    name: spell?.name ?? signature.spellId,
    maximumCharges: signature.charges,
    rechargePerFloor: signature.rechargePerFloor,
  };
}

export interface DrawbackRow {
  readonly label: string;
  readonly value: string;
}

/** The equipped-drawback modifiers as signed display rows, in the content's own key order (the
 * compiler preserves it), so the inspect pane states the cost of carrying the thing. */
export function artifactDrawbackRows(
  pack: CompiledContentPack,
  contentId: string | undefined,
): readonly DrawbackRow[] {
  const artifact = artifactOf(pack, contentId);
  if (!artifact) return [];
  return Object.entries(artifact.drawbackModifiers).map(([label, amount]) => ({
    label,
    value: `${amount >= 0 ? '+' : ''}${amount}`,
  }));
}

const OUTCOME_TEXT: Readonly<Record<ArtifactStintOutcome, string>> = {
  'died-with': 'fell',
  recovered: 'reclaimed it',
  'escaped-with': 'carried it out',
  'reclaimed-by-the-deep': 'the Deep took it back',
};

/**
 * How a run that LEFT the Deep with the artifact reads, per the Hall record's own completion type.
 * Only `escaped-with` is overridden: it is the one outcome whose meaning depends on how the run
 * ended, and the record is the authority on that -- a hero who became the Heart did not merely
 * "carry it out". Every other outcome describes the artifact's fate rather than the run's, so the
 * stint's own text stands.
 */
const ESCAPE_TEXT: Readonly<Record<CompletionType, string>> = {
  'broke-cycle': 'broke the cycle with it',
  'became-heart': 'was bound into the Heart with it',
  refused: 'refused the Deep with it',
  died: OUTCOME_TEXT['died-with'],
};

/**
 * One provenance line: `Borne by <heroName> — <outcome text> at depth <depth>`. The depth clause is
 * dropped only for a depth-0 `reclaimed-by-the-deep` stint, which is what the ledger's reconcile
 * pass stamps when it has no depth to record -- "at depth 0" would read as the surface. Every other
 * outcome keeps its depth verbatim, including a genuine depth 0: a hero can die (or refuse, or
 * become the Heart) in town, and finalization stamps that real depth on the stint.
 */
export function provenanceLine(
  stint: ArtifactStint,
  completionType: CompletionType | undefined,
): string {
  const text =
    stint.outcome === 'escaped-with' && completionType !== undefined
      ? ESCAPE_TEXT[completionType]
      : OUTCOME_TEXT[stint.outcome];
  const depthless = stint.outcome === 'reclaimed-by-the-deep' && stint.depth === 0;
  const where = depthless ? '' : ` at depth ${stint.depth}`;
  return `Borne by ${stint.heroName} — ${text}${where}`;
}

function completionTypeById(
  records: readonly StoredHallRecord[],
): ReadonlyMap<string, CompletionType> {
  return new Map(records.map((record) => [record.recordId, record.completionType]));
}

function linesFor(
  provenance: readonly ArtifactStint[],
  completions: ReadonlyMap<string, CompletionType>,
): readonly string[] {
  return provenance.map((stint) => provenanceLine(stint, completions.get(stint.recordId)));
}

/**
 * Every provenance line for `contentId`, oldest first. Empty when the ledger has never held that
 * artifact -- which is also the answer for an unidentified item (no `contentId`).
 */
export function provenanceLines(
  ledger: ArtifactLedger,
  contentId: string | undefined,
  records: readonly StoredHallRecord[],
): readonly string[] {
  if (contentId === undefined) return [];
  const entry = ledger.find((candidate) => candidate.artifactId === contentId);
  if (!entry) return [];
  return linesFor(entry.provenance, completionTypeById(records));
}

export interface RelicRow {
  readonly artifactId: string;
  readonly name: string;
  readonly lastStint: string;
}

export interface RelicsOverview {
  /** Every artifact this profile has touched, in the ledger's own (artifact-id) order. */
  readonly known: readonly RelicRow[];
  /** Artifacts the pack defines that the ledger has never recorded a stint for. A count only --
   * naming them would spoil what is still out there to find. */
  readonly undiscoveredCount: number;
  readonly artifactCount: number;
}

/**
 * The Hall's "Relics of the Deep" model. A ledger entry is "known" whether it is currently `lost`
 * (a fallen hero holds it) or back to `undiscovered` after the Deep reclaimed it -- the player has
 * seen it either way, so its name and last stint stay visible; only artifacts with no ledger entry
 * at all are unfound.
 *
 * This "known" set is deliberately NOT the engine's `undiscoveredArtifactIds`, which asks a
 * different question: that one drives spawn weighting (anything not currently held by a champion is
 * placeable again), this one drives spoiler avoidance (anything the player has laid eyes on may be
 * named). A reclaimed relic is in both -- placeable there, still named here.
 */
export function relicsOverview(
  pack: CompiledContentPack,
  ledger: ArtifactLedger,
  records: readonly StoredHallRecord[],
): RelicsOverview {
  const completions = completionTypeById(records);
  const artifactCount = itemEntries(pack).filter((entry) => entry.artifact !== null).length;
  const known = ledger.flatMap((entry): readonly RelicRow[] => {
    const lastStint = entry.provenance[entry.provenance.length - 1];
    if (lastStint === undefined) return [];
    return [
      {
        artifactId: entry.artifactId,
        name: itemById(pack, entry.artifactId)?.name ?? entry.artifactId,
        lastStint: provenanceLine(lastStint, completions.get(lastStint.recordId)),
      },
    ];
  });
  return {
    known,
    undiscoveredCount: Math.max(0, artifactCount - known.length),
    artifactCount,
  };
}
