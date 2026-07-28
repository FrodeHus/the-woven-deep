import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { HintFloat } from './HintFloat.js';
import type { HintDefinition } from '../../session/onboarding.js';
import { DEFAULT_SETTINGS, resolveKeymap } from '../../session/settings.js';

const defaultKeymap = resolveKeymap(DEFAULT_SETTINGS.bindings);

const hint: HintDefinition = {
  id: 'inspection',
  priority: 1,
  mastery: { kind: 'intent-count', intentType: 'open-character-sheet', count: 1 },
  trigger: () => true,
  copy: (keymap) => `Press ${keymap.byAction['character-sheet'].key} to read your own measure.`,
};

describe('HintFloat', () => {
  it('shows the active hint copy and its dismiss chord as a role="note" (never alert/status)', () => {
    render(<HintFloat hint={hint} keymap={defaultKeymap} />);
    const note = screen.getByRole('note');
    expect(note).toHaveTextContent('Press c to read your own measure.');
    // The dismiss affordance shows the rebindable `dismiss-hint` chord (default `'`).
    expect(note).toHaveTextContent("(' to dismiss)");
  });

  it('renders nothing when there is no active hint -- which is also the onboarding-off case', () => {
    const { container } = render(<HintFloat hint={null} keymap={defaultKeymap} />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
  });

  it('disappears once the hint clears (the dismiss republish drives hint to null)', () => {
    const { rerender } = render(<HintFloat hint={hint} keymap={defaultKeymap} />);
    expect(screen.getByRole('note')).toBeInTheDocument();
    rerender(<HintFloat hint={null} keymap={defaultKeymap} />);
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
  });

  it('interpolates the LIVE chord from the resolved keymap -- a rebind changes the copy', () => {
    const rebound = resolveKeymap({ 'character-sheet': { key: 'p', shift: false } });
    render(<HintFloat hint={hint} keymap={rebound} />);
    expect(screen.getByRole('note')).toHaveTextContent('Press p to read your own measure.');
  });

  it('never steals focus on appear -- activeElement is unchanged', () => {
    document.body.focus();
    const before = document.activeElement;
    render(<HintFloat hint={hint} keymap={defaultKeymap} />);
    expect(document.activeElement).toBe(before);
  });
});
