import type { WizardState } from '../../../session/wizard-reducer.js';

/** Per-step subtitle copy shown under the serif step title in the center header, verbatim from
 * the mockup design spec (docs/superpowers/plans/2026-07-21-chargen-redesign.md). */
export const STEP_SUBTITLES: Readonly<Record<WizardState['step'], string>> = {
  1: 'Who descends, and how the Hall will write it.',
  2: 'What you are. Two callings are still locked below.',
  3: 'How your calling carries its tools.',
  4: 'Spend the budget, or let the Loom cast the dice.',
  5: 'Where you came from. It follows you down.',
  6: 'Up to two marks. Or none — purity is also a choice.',
  7: 'Read the record. Then pull the thread.',
};

/** The flavor lines under the left-rail step list, below a top-bordered spacer. */
export const LOOM_FOOTER_LINES: readonly string[] = [
  'Many enter.',
  'Few return.',
  'All are woven in.',
];
