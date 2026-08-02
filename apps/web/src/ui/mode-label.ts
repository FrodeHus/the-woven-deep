import type { RunMode } from '@woven-deep/engine';

/** The one display name per run mode -- every surface that prints a mode (chargen menu and
 * review, hero record, character sheet, conclusion epilogue) reads this instead of restating the
 * ternary. */
export const MODE_LABELS: Readonly<Record<RunMode, string>> = {
  classic: 'Classic',
  wanderer: 'Wanderer',
};

export function modeLabel(mode: RunMode): string {
  return MODE_LABELS[mode];
}
