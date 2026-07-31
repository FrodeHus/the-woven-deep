import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { ProvisionsMeter } from './ProvisionsMeter.js';

/** Renders one stage in isolation and hands back its fill element plus the unmount handle, so each
 * assertion works against exactly one meter. */
function fillOf(stage: string): Readonly<{ fill: HTMLElement; unmount: () => void }> {
  const { unmount } = render(<ProvisionsMeter stage={stage} />);
  return { fill: screen.getByTestId('provisions-fill'), unmount };
}

describe('ProvisionsMeter', () => {
  it('labels itself with the current stage for assistive tech', () => {
    render(<ProvisionsMeter stage="hungry" />);
    expect(screen.getByRole('img', { name: 'Provisions: hungry' })).toBeInTheDocument();
    expect(screen.getByTestId('provisions-meter')).toHaveAttribute('data-stage', 'hungry');
  });

  it('drains the column stage by stage', () => {
    const heights = ['sated', 'hungry', 'weak', 'starving'].map((stage) => {
      const { fill, unmount } = fillOf(stage);
      const height = Number.parseInt(fill.style.height, 10);
      unmount();
      return height;
    });
    expect(heights[0]).toBe(100);
    for (let index = 1; index < heights.length; index += 1) {
      expect(heights[index]!).toBeLessThan(heights[index - 1]!);
    }
  });

  it('reads quiet when sated and amber once hungry', () => {
    const sated = fillOf('sated');
    expect(sated.fill.style.backgroundColor).toContain('--color-muted');
    sated.unmount();

    const hungry = fillOf('hungry');
    expect(hungry.fill.style.backgroundColor).toContain('--color-warn');
    hungry.unmount();
  });

  it('pulses in the danger color only when starving', () => {
    const weak = fillOf('weak');
    expect(weak.fill.style.backgroundColor).toContain('--color-accent');
    expect(weak.fill.className).not.toContain('animate-pulse');
    weak.unmount();

    const starving = fillOf('starving');
    expect(starving.fill.style.backgroundColor).toContain('--color-danger');
    expect(starving.fill.className).toContain('animate-pulse');
    starving.unmount();
  });

  it('falls back to the sated presentation for an unrecognized stage', () => {
    const unknown = fillOf('who-knows');
    expect(unknown.fill.style.height).toBe('100%');
    unknown.unmount();
  });
});
