import type { CSSProperties, JSX } from 'react';
import type { CompiledContentPack } from '@woven-deep/content';
import { monsterById } from '../session/pack-queries.js';

export interface ThreatPopoverActor {
  readonly name?: string;
  readonly glyph?: string;
  readonly disposition: string;
  readonly healthPresentation: { readonly band: string };
  readonly intentPresentation?: string;
  readonly contentId?: string | null;
}

export interface ThreatPopoverProps {
  readonly actor: ThreatPopoverActor;
  /** Pane-relative pixel position of the hovered cell (the pointer's client position minus the map
   * pane's own origin), clamped here so the popover never renders past the pane bounds. */
  readonly leftPx: number;
  readonly topPx: number;
  /** The map pane's pixel size, used as the clamp bound. */
  readonly paneWidthPx: number;
  readonly paneHeightPx: number;
  /** Looked up by `actor.contentId` to surface the monster's authored `description`, if any --
   * the pack is the single source for that text, never threaded through the engine projection. */
  readonly pack: CompiledContentPack;
}

/**
 * A mouse convenience only: the same fields (name, glyph, health band, intent, disposition) stay
 * keyboard-reachable via the `<details>` threat drawer that `PlayScreen` renders alongside this at
 * `compact`/`minimal` tiers. Non-focusable and dismissed by the caller on mouseleave, scroll, or a
 * new session snapshot (see `PlayScreen`), so it never gets stranded pointing at a stale cell.
 */
export function ThreatPopover({
  actor,
  leftPx,
  topPx,
  paneWidthPx,
  paneHeightPx,
  pack,
}: ThreatPopoverProps): JSX.Element {
  const style: CSSProperties = {
    left: `${Math.max(0, Math.min(leftPx, paneWidthPx))}px`,
    top: `${Math.max(0, Math.min(topPx, paneHeightPx))}px`,
  };
  const description = actor.contentId ? monsterById(pack, actor.contentId)?.description : undefined;

  return (
    <div role="tooltip" className="threat-popover framed" style={style}>
      <strong>{actor.name ?? 'Something'}</strong>
      {actor.glyph && <span aria-hidden="true">{actor.glyph}</span>}
      <div>{`Health: ${actor.healthPresentation.band}`}</div>
      {actor.intentPresentation && <div>{`Intent: ${actor.intentPresentation}`}</div>}
      <div>{`Disposition: ${actor.disposition}`}</div>
      {description && <p className="threat-popover-description">{description}</p>}
    </div>
  );
}
